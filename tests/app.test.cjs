const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const key = "build-log.projects";
const existing = { name: "Existing project", status: "Done", nextAction: "Keep me" };

// Minimal DOM/storage doubles; these tests do not simulate browser layout or input validation.
function element() {
  return {
    value: "", textContent: "", children: [], listeners: {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(type, callback) { this.listeners[type] = callback; },
    setCustomValidity() {}, reportValidity() {}, focus() {},
  };
}

function browser() {
  const state = { saved: JSON.stringify([existing]), failRead: false, failWrite: false };
  const storage = {
    getItem(storageKey) {
      assert.equal(storageKey, key);
      if (state.failRead) throw new Error("Storage blocked");
      return state.saved;
    },
    setItem(storageKey, value) {
      assert.equal(storageKey, key);
      if (state.failWrite) throw new Error("Storage full");
      state.saved = value;
    },
  };

  function tab() {
    const elements = {};
    const listeners = {};
    const document = {
      querySelector(selector) { return elements[selector] ??= element(); },
      createElement: element,
      createTextNode(text) { return { textContent: text }; },
    };
    const window = { addEventListener(type, callback) { listeners[type] = callback; } };
    vm.runInNewContext(source, { document, window, localStorage: storage });
    const name = elements["#project-name"];
    const status = elements["#project-status"];
    const nextAction = elements["#next-action"];
    const form = elements["#project-form"];
    form.reset = () => { name.value = ""; status.value = "Planned"; nextAction.value = ""; };
    return {
      elements,
      draft(projectName) {
        name.value = projectName;
        status.value = "In progress";
        nextAction.value = "Keep typing";
      },
      submit() { form.listeners.submit({ preventDefault() {} }); },
      names() {
        return elements["#project-list"].children.map(item => item.children[0].children[0].textContent);
      },
      storageEvent(event = {}) {
        assert.equal(typeof listeners.storage, "function", "A storage listener must be registered");
        listeners.storage({ key, storageArea: storage, ...event });
      },
    };
  }
  return { state, tab };
}

test("stale tab preserves existing projects and both sequential additions without receiving an event", () => {
  const app = browser();
  const a = app.tab();
  const b = app.tab();
  a.draft("Tab A test");
  a.submit();
  b.draft("Tab B test");
  b.submit();
  const saved = JSON.parse(app.state.saved);
  assert.deepEqual(saved[0], existing);
  assert.deepEqual(saved.map(project => project.name), ["Existing project", "Tab A test", "Tab B test"]);
  assert.deepEqual(app.tab().names(), saved.map(project => project.name));
  assert.deepEqual(app.tab().names(), saved.map(project => project.name));
});

test("storage events refresh the list without changing a draft or writing storage", () => {
  const app = browser();
  const a = app.tab();
  const b = app.tab();
  b.draft("Unsubmitted draft");
  a.draft("Tab A test");
  a.submit();
  const saved = app.state.saved;
  b.storageEvent({ newValue: "stale event payload" });
  assert.deepEqual(b.names(), ["Existing project", "Tab A test"]);
  assert.equal(b.elements["#project-name"].value, "Unsubmitted draft");
  assert.equal(b.elements["#project-status"].value, "In progress");
  assert.equal(b.elements["#next-action"].value, "Keep typing");
  assert.equal(app.state.saved, saved);
});

test("unrelated storage events are ignored; project removal and storage clear refresh the list", () => {
  const app = browser();
  const tab = app.tab();
  app.state.saved = null;
  tab.storageEvent({ key: "unrelated" });
  tab.storageEvent({ storageArea: {} });
  assert.deepEqual(tab.names(), ["Existing project"]);
  tab.storageEvent({ newValue: null });
  assert.deepEqual(tab.names(), []);
  app.state.saved = JSON.stringify([existing]);
  tab.storageEvent();
  app.state.saved = null;
  tab.storageEvent({ key: null });
  assert.deepEqual(tab.names(), []);
});

test("failed or invalid fresh reads preserve storage and the draft instead of overwriting", () => {
  for (const failure of ["blocked", "invalid JSON", "invalid shape"]) {
    const app = browser();
    const tab = app.tab();
    tab.draft("Unsaved project");
    if (failure === "blocked") app.state.failRead = true;
    if (failure === "invalid JSON") app.state.saved = "broken JSON";
    if (failure === "invalid shape") app.state.saved = '[{"name":""}]';
    const saved = app.state.saved;
    tab.storageEvent();
    assert.ok(tab.elements["#error-message"].textContent);
    tab.submit();
    assert.match(tab.elements["#error-message"].textContent, /couldn’t be read/);
    assert.equal(tab.elements["#project-name"].value, "Unsaved project");
    assert.equal(app.state.saved, saved);
    assert.deepEqual(tab.names(), ["Existing project"]);
  }
});

test("write failure keeps the draft; retry preserves the other tab's addition exactly once", () => {
  const app = browser();
  const a = app.tab();
  const b = app.tab();
  a.draft("Tab A test");
  a.submit();
  b.draft("Tab B test");
  const saved = app.state.saved;
  app.state.failWrite = true;
  b.submit();
  assert.equal(app.state.saved, saved);
  assert.equal(b.elements["#project-name"].value, "Tab B test");
  assert.match(b.elements["#error-message"].textContent, /Couldn’t save/);
  assert.ok(!b.names().includes("Tab B test"));
  app.state.failWrite = false;
  b.submit();
  assert.deepEqual(JSON.parse(app.state.saved).map(project => project.name), ["Existing project", "Tab A test", "Tab B test"]);
  assert.equal(b.elements["#project-name"].value, "");
});
