const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");

const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const key = "build-log.projects";
const existing = { id: "existing-project", name: "Existing project", status: "Done", nextAction: "Keep me" };

// Minimal DOM/storage doubles; these tests do not simulate browser layout or input validation.
function element() {
  return {
    value: "", textContent: "", children: [], listeners: {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(type, callback) { this.listeners[type] = callback; },
    click() { this.clicks = (this.clicks || 0) + 1; return this.listeners.click?.(); },
    setAttribute(name, value) { this[name] = value; },
    setCustomValidity(message) { this.validationMessage = message; },
    reportValidity() { this.validityReported = true; },
    focus() {},
  };
}

function browser(initialProjects = [existing]) {
  const state = { saved: JSON.stringify(initialProjects), failRead: false, failWrite: false, writes: 0 };
  const storage = {
    getItem(storageKey) {
      assert.equal(storageKey, key);
      if (state.failRead) throw new Error("Storage blocked");
      return state.saved;
    },
    setItem(storageKey, value) {
      assert.equal(storageKey, key);
      if (state.failWrite) throw new Error("Storage full");
      state.writes++;
      state.saved = value;
    },
  };

  function tab() {
    const elements = {};
    const listeners = {};
    const confirmation = { answer: true, messages: [], onConfirm() {} };
    const downloads = [];
    const urls = new Map();
    const revoked = [];
    const timers = [];
    const downloadFailures = { createUrl: false, click: false };
    const requests = [];
    const network = { respond: async () => { throw new Error("No mock response configured"); } };
    const document = {
      body: element(),
      querySelector(selector) {
        if (!elements[selector]) {
          elements[selector] = element();
          if (selector === "#project-status") elements[selector].value = "Planned";
        }
        const control = elements[selector];
        control.focus = () => { document.activeElement = control; };
        return control;
      },
      createElement(tag) {
        const node = element();
        node.remove = () => { document.body.children = document.body.children.filter(child => child !== node); };
        if (tag === "a") node.click = () => {
          assert.ok(document.body.children.includes(node));
          if (downloadFailures.click) throw new Error("Download blocked");
          downloads.push({ filename: node.download, blob: urls.get(node.href), url: node.href });
        };
        return node;
      },
      createTextNode(text) { return { textContent: text }; },
    };
    const window = {
      addEventListener(type, callback) { listeners[type] = callback; },
      confirm(message) {
        confirmation.messages.push(message);
        confirmation.onConfirm();
        return confirmation.answer;
      },
    };
    const URL = {
      createObjectURL(blob) {
        if (downloadFailures.createUrl) throw new Error("URL unavailable");
        const url = `blob:test-${urls.size}`;
        urls.set(url, blob);
        return url;
      },
      revokeObjectURL(url) { revoked.push(url); },
    };
    class ExportDate extends Date {
      constructor() { super(2026, 0, 2, 23, 30); }
    }
    vm.runInNewContext(source, {
      document, window, localStorage: storage, crypto: { randomUUID }, Blob, URL, Date: ExportDate,
      fetch(url, options) { requests.push({ url, options }); return network.respond(); },
      setTimeout(callback, delay) { timers.push({ callback, delay }); },
    });
    const name = elements["#project-name"];
    const status = elements["#project-status"];
    const nextAction = elements["#next-action"];
    const form = elements["#project-form"];
    form.reset = () => { name.value = ""; status.value = "Planned"; nextAction.value = ""; };
    return {
      elements,
      requests, network,
      loadSuggestions() { return elements["#load-suggestions"].listeners.click(); },
      downloads, urls, revoked, downloadFailures,
      exportProjects() { elements["#export-projects"].listeners.click(); },
      openImport() { elements["#import-projects"].listeners.click(); },
      chooseImport(contents) {
        elements["#import-file"].files = contents === null ? [] : [
          typeof contents === "string" ? { text: async () => contents } : contents,
        ];
        return elements["#import-file"].listeners.change();
      },
      confirmImport() { elements["#confirm-import"].listeners.click(); },
      cancelImport() { elements["#cancel-import"].listeners.click(); },
      flushDownloadCleanup() { timers.splice(0).forEach(timer => timer.callback()); },
      temporaryLinks() { return document.body.children.length; },
      activeElement() { return document.activeElement; },
      confirmation,
      deleteButton(index = 0) { return elements["#project-list"].children[index].children[0].children[2]; },
      remove(index = 0) { this.deleteButton(index).listeners.click(); },
      edit(index = 0) {
        const button = elements["#project-list"].children[index].children[0].children.find(child => child.textContent === "Edit");
        assert.equal(button.type, "button");
        assert.match(button["aria-label"], /^Edit project: /);
        button.listeners.click();
      },
      editDraft(name, status = "In progress", nextAction = "Edited next step") {
        elements["#project-name"].value = name;
        elements["#project-name"].listeners.input();
        elements["#project-status"].value = status;
        elements["#next-action"].value = nextAction;
      },
      saveEdit() { elements["#project-form"].listeners.submit({ preventDefault() {} }); },
      cancelEdit() { elements["#cancel-edit"].listeners.click(); },
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

test("import previews counts, requires confirmation, keeps existing IDs, and copies only supported fields", async () => {
  const original = { ...existing, extra: { keep: true } };
  const app = browser([original]);
  const tab = app.tab();
  const incoming = { id: "new-id", name: existing.name, status: "Planned", nextAction: "" };
  const file = JSON.stringify([{ ...existing, name: "Must not overwrite" }, { ...incoming, extra: "Ignore", constructor: "Ignore" }]).replace('"extra":"Ignore"', '"extra":"Ignore","__proto__":{"polluted":true}');
  const saved = app.state.saved;
  await tab.chooseImport(file);
  assert.equal(app.state.saved, saved);
  assert.equal(app.state.writes, 0);
  assert.deepEqual(tab.names(), [existing.name]);
  assert.equal(tab.elements["#import-preview"].hidden, false);
  assert.match(tab.elements["#import-summary"].textContent, /1 new project\(s\).*1 existing ID/);
  assert.match(tab.elements["#import-summary"].textContent, /kept unchanged, even if the file has different fields/);
  tab.confirmImport();
  assert.deepEqual(JSON.parse(app.state.saved), [original, incoming]);
  assert.deepEqual(app.tab().names(), [existing.name, existing.name]);
  assert.equal(tab.elements["#import-preview"].hidden, true);
  assert.equal(app.state.writes, 1);
});

test("canceling the picker or preview does not change saved data or allow an unconfirmed import", async () => {
  const app = browser();
  const tab = app.tab();
  const saved = app.state.saved;
  tab.confirmImport();
  tab.openImport();
  assert.equal(tab.elements["#import-file"].clicks, 1);
  await tab.chooseImport(null);
  assert.equal(app.state.saved, saved);
  await tab.chooseImport(JSON.stringify([{ ...existing, id: "new" }]));
  const summary = tab.elements["#import-summary"].textContent;
  tab.openImport();
  await tab.chooseImport(null);
  assert.equal(tab.elements["#import-summary"].textContent, summary);
  assert.equal(tab.elements["#import-preview"].hidden, false);
  app.state.failRead = true;
  tab.cancelImport();
  tab.confirmImport();
  assert.equal(app.state.saved, saved);
  assert.equal(app.state.writes, 0);
  assert.equal(tab.elements["#import-preview"].hidden, true);
  assert.deepEqual(tab.names(), [existing.name]);
});

test("empty and repeated imports are idempotent and do not rewrite storage", async () => {
  const app = browser();
  const tab = app.tab();
  const incoming = { ...existing, id: "new" };
  await tab.chooseImport("[]");
  assert.match(tab.elements["#import-summary"].textContent, /0 new project\(s\).*0 existing ID/);
  tab.confirmImport();
  assert.equal(app.state.writes, 0);
  const file = JSON.stringify([incoming]);
  await tab.chooseImport(file);
  tab.confirmImport();
  const saved = app.state.saved;
  await tab.chooseImport(file);
  assert.match(tab.elements["#import-summary"].textContent, /0 new project\(s\).*1 existing ID/);
  tab.confirmImport();
  assert.equal(app.state.saved, saved);
  assert.equal(app.state.writes, 1);
});

test("the entire import is rejected for malformed JSON, invalid fields, missing IDs, or duplicate IDs", async () => {
  const incoming = { ...existing, id: "new" };
  const invalidRecords = [null, [], { ...incoming, id: undefined }, { ...incoming, id: " " },
    { ...incoming, id: 7 }, { ...incoming, name: "\t " }, { ...incoming, name: 1 },
    { ...incoming, status: "Unknown" }, { ...incoming, nextAction: null },
    { ...incoming, nextAction: undefined }, { ...existing, nextAction: 1 }];
  const invalidFiles = ["bad JSON", "null", "{}", '"text"',
    JSON.stringify([incoming, incoming]),
    ...invalidRecords.map(record => JSON.stringify([{ ...incoming, id: "valid-first" }, record]))];
  for (const file of invalidFiles) {
    const app = browser();
    const tab = app.tab();
    const saved = app.state.saved;
    await tab.chooseImport(file);
    assert.ok(tab.elements["#import-error"].textContent);
    assert.equal(tab.elements["#import-preview"].hidden, true);
    tab.confirmImport();
    assert.equal(app.state.saved, saved);
    assert.equal(app.state.writes, 0);
    assert.deepEqual(tab.names(), [existing.name]);
  }
});

test("storage errors during preview never write or enable confirmation", async () => {
  for (const stored of ["blocked", "broken JSON", JSON.stringify([existing, existing]), JSON.stringify([{ name: "Legacy", status: "Done", nextAction: "" }])]) {
    const app = browser();
    const tab = app.tab();
    if (stored === "blocked") app.state.failRead = true;
    else app.state.saved = stored;
    const saved = app.state.saved;
    await tab.chooseImport(JSON.stringify([{ ...existing, id: "new" }]));
    assert.match(tab.elements["#import-error"].textContent, /Couldn’t read existing projects/);
    tab.confirmImport();
    assert.equal(app.state.saved, saved);
    assert.equal(app.state.writes, 0);
  }
});

test("confirmation recomputes the merge and keeps newer records, additions, and unrelated deletions", async () => {
  const removed = { ...existing, id: "remove-me", name: "Removed later" };
  const app = browser([existing, removed]);
  const tab = app.tab();
  const other = app.tab();
  const incoming = { ...existing, id: "incoming", name: "File version" };
  const addition = { ...existing, id: "another-new", name: "New from file" };
  await tab.chooseImport(JSON.stringify([existing, incoming, addition]));
  assert.match(tab.elements["#import-summary"].textContent, /2 new project\(s\).*1 existing ID/);
  const latest = [{ ...existing, name: "Updated elsewhere" }, { ...incoming, name: "Saved since preview" }, { ...existing, id: "unrelated", name: "Unrelated addition" }];
  app.state.saved = JSON.stringify(latest);
  tab.confirmImport();
  assert.deepEqual(JSON.parse(app.state.saved), [...latest, addition]);
  assert.match(tab.elements["#import-message"].textContent, /Imported 1 new project\(s\); skipped 2 existing ID/);
  other.storageEvent();
  assert.deepEqual(other.names(), tab.names());
});

test("confirmation failures keep the list, data, and preview intact and allow a retry", async () => {
  for (const failure of ["read", "write", "invalid data"]) {
    const app = browser();
    const tab = app.tab();
    const incoming = { ...existing, id: "new" };
    await tab.chooseImport(JSON.stringify([incoming]));
    if (failure === "read") app.state.failRead = true;
    if (failure === "write") app.state.failWrite = true;
    if (failure === "invalid data") app.state.saved = "{}";
    const saved = app.state.saved;
    tab.confirmImport();
    assert.equal(app.state.saved, saved);
    assert.equal(app.state.writes, 0);
    assert.deepEqual(tab.names(), [existing.name]);
    assert.equal(tab.elements["#import-preview"].hidden, false);
    assert.match(tab.elements["#import-error"].textContent, /Couldn’t import projects/);
    app.state.failRead = false;
    app.state.failWrite = false;
    app.state.saved = JSON.stringify([existing]);
    tab.confirmImport();
    assert.deepEqual(JSON.parse(app.state.saved), [existing, incoming]);
    assert.equal(tab.elements["#import-error"].textContent, "");
  }
});

test("import success, failure, and cancellation preserve Edit and suspended Add drafts", async () => {
  for (const finish of ["confirm", "cancel", "fail"]) {
    const app = browser();
    const tab = app.tab();
    tab.draft("  Add draft  ");
    tab.edit();
    tab.editDraft("  Edit draft  ", "Planned", "Edit action");
    tab.elements["#error-message"].textContent = "Existing form error";
    await tab.chooseImport(JSON.stringify([{ ...existing, id: "new" }]));
    if (finish === "fail") app.state.failWrite = true;
    if (finish === "cancel") tab.cancelImport();
    else tab.confirmImport();
    assert.equal(tab.elements["#project-name"].value, "  Edit draft  ");
    assert.equal(tab.elements["#project-status"].value, "Planned");
    assert.equal(tab.elements["#next-action"].value, "Edit action");
    assert.equal(tab.elements["#form-heading"].textContent, "Edit project");
    assert.equal(tab.elements["#error-message"].textContent, "Existing form error");
    tab.cancelEdit();
    assert.equal(tab.elements["#project-name"].value, "  Add draft  ");
    assert.equal(tab.elements["#project-status"].value, "In progress");
    assert.equal(tab.elements["#next-action"].value, "Keep typing");
  }
});

test("file read failures and invalid replacement files cannot confirm an earlier preview", async () => {
  const app = browser();
  const tab = app.tab();
  const valid = JSON.stringify([{ ...existing, id: "new" }]);
  for (const replacement of ["bad JSON", { text: async () => { throw new Error("Unreadable"); } }]) {
    await tab.chooseImport(valid);
    await tab.chooseImport(replacement);
    assert.ok(tab.elements["#import-error"].textContent);
    assert.equal(tab.elements["#import-preview"].hidden, true);
    tab.confirmImport();
    assert.equal(app.state.writes, 0);
  }
});

test("an obsolete asynchronous file read cannot replace a newer preview or a cancellation", async () => {
  for (const cancel of [false, true]) {
    const app = browser();
    const tab = app.tab();
    let resolveOld;
    const oldRead = tab.chooseImport({ text: () => new Promise(resolve => { resolveOld = resolve; }) });
    if (cancel) tab.cancelImport();
    else await tab.chooseImport(JSON.stringify([{ ...existing, id: "newer" }]));
    resolveOld(JSON.stringify([{ ...existing, id: "older" }]));
    await oldRead;
    tab.confirmImport();
    assert.deepEqual(JSON.parse(app.state.saved), cancel ? [existing] : [existing, { ...existing, id: "newer" }]);
  }
});

test("an exported backup can be imported into empty storage and exported again", async () => {
  const original = [existing, { id: "second", name: "<b>Résumé</b>", status: "In progress", nextAction: "<script>literal</script>" }];
  const sourceApp = browser(original);
  const sourceTab = sourceApp.tab();
  sourceTab.exportProjects();
  const file = await sourceTab.downloads[0].blob.text();
  const targetApp = browser([]);
  targetApp.state.saved = null;
  const target = targetApp.tab();
  await target.chooseImport(file);
  target.confirmImport();
  assert.deepEqual(JSON.parse(targetApp.state.saved), original);
  assert.deepEqual(target.names(), original.map(project => project.name));
  target.exportProjects();
  assert.equal(await target.downloads[0].blob.text(), file);
  sourceTab.flushDownloadCleanup();
  target.flushDownloadCleanup();
});

test("export downloads readable JSON with a local-date filename and releases its URL", async () => {
  const records = [existing, { id: "other", name: "Résumé <b>text</b>", status: "Planned", nextAction: "", extra: { keep: true } }];
  const app = browser(records);
  const tab = app.tab();
  const saved = app.state.saved;
  tab.exportProjects();
  assert.equal(tab.downloads.length, 1);
  const download = tab.downloads[0];
  assert.equal(download.filename, "build-log-projects-2026-01-02.json");
  assert.equal(download.blob.type, "application/json");
  assert.equal(await download.blob.text(), JSON.stringify(records, null, 2));
  assert.equal(app.state.saved, saved);
  assert.equal(app.state.writes, 0);
  assert.equal(tab.temporaryLinks(), 0);
  assert.equal(tab.revoked.length, 0);
  tab.flushDownloadCleanup();
  assert.deepEqual(tab.revoked, [download.url]);
});

test("export reads current storage rather than a stale tab's displayed projects", async () => {
  const app = browser();
  const a = app.tab();
  const b = app.tab();
  a.draft("Other tab addition");
  a.submit();
  a.edit(0);
  a.editDraft("Latest name", "Planned", "Latest action");
  a.saveEdit();
  const saved = app.state.saved;
  const writes = app.state.writes;
  b.exportProjects();
  assert.deepEqual(JSON.parse(await b.downloads[0].blob.text()), JSON.parse(saved));
  assert.equal(app.state.saved, saved);
  assert.equal(app.state.writes, writes);
  a.remove(0);
  b.exportProjects();
  assert.deepEqual(JSON.parse(await b.downloads[1].blob.text()), JSON.parse(app.state.saved));
  b.flushDownloadCleanup();
  assert.equal(b.revoked.length, 2);
});

test("export of an empty or missing saved list is exactly []", async () => {
  for (const value of ["[]", null]) {
    const app = browser();
    const tab = app.tab();
    app.state.saved = value;
    tab.exportProjects();
    assert.equal(await tab.downloads[0].blob.text(), "[]");
    assert.equal(app.state.saved, value);
    assert.equal(app.state.writes, 0);
    tab.flushDownloadCleanup();
  }
});

test("export preserves Add and Edit drafts, suspended Add fields, mode, and save errors", async () => {
  const app = browser();
  const tab = app.tab();
  tab.draft("  Add draft  ");
  tab.elements["#error-message"].textContent = "Previous save error";
  tab.exportProjects();
  assert.equal(tab.elements["#project-name"].value, "  Add draft  ");
  assert.equal(tab.elements["#form-heading"].textContent, "Add project");
  assert.equal(tab.elements["#error-message"].textContent, "Previous save error");
  tab.edit();
  tab.editDraft("Unsaved edit", "Planned", "Unsaved action");
  app.state.failWrite = true; // Export must work even when writes are blocked.
  tab.exportProjects();
  assert.deepEqual(JSON.parse(await tab.downloads[1].blob.text()), [existing]);
  assert.equal(tab.elements["#project-name"].value, "Unsaved edit");
  assert.equal(tab.elements["#project-status"].value, "Planned");
  assert.equal(tab.elements["#next-action"].value, "Unsaved action");
  assert.equal(tab.elements["#form-heading"].textContent, "Edit project");
  tab.cancelEdit();
  assert.equal(tab.elements["#project-name"].value, "  Add draft  ");
  assert.equal(tab.elements["#project-status"].value, "In progress");
  assert.equal(tab.elements["#next-action"].value, "Keep typing");
  assert.equal(app.state.writes, 0);
  tab.flushDownloadCleanup();
});

test("unreadable or invalid data prevents export without changing storage or drafts", () => {
  for (const value of ["blocked", "bad JSON", "{}", "null", "[null]",
    JSON.stringify([{ ...existing, name: " " }]),
    JSON.stringify([{ ...existing, status: "invalid" }]),
    JSON.stringify([{ ...existing, nextAction: null }]),
    JSON.stringify([{ ...existing, id: "" }]),
    JSON.stringify([existing, existing]),
    JSON.stringify([{ name: "Legacy", status: "Done", nextAction: "Keep me" }])]) {
    const app = browser();
    const tab = app.tab();
    tab.draft("Keep draft");
    if (value === "blocked") app.state.failRead = true;
    else app.state.saved = value;
    const saved = app.state.saved;
    tab.exportProjects();
    assert.equal(tab.downloads.length, 0);
    assert.equal(tab.urls.size, 0);
    assert.equal(app.state.writes, 0);
    assert.equal(app.state.saved, saved);
    assert.equal(tab.elements["#project-name"].value, "Keep draft");
    assert.match(tab.elements["#export-error"].textContent, /Couldn’t read saved projects/);
    assert.equal(tab.elements["#export-message"].textContent, "");
    app.state.failRead = false;
    app.state.saved = JSON.stringify([existing]);
    tab.exportProjects();
    assert.equal(tab.downloads.length, 1);
    assert.equal(tab.elements["#export-error"].textContent, "");
    tab.flushDownloadCleanup();
  }
});

test("download setup failures show an error and release any created URL", () => {
  for (const failure of ["createUrl", "click"]) {
    const app = browser();
    const tab = app.tab();
    tab.downloadFailures[failure] = true;
    tab.exportProjects();
    assert.equal(tab.downloads.length, 0);
    assert.equal(tab.temporaryLinks(), 0);
    assert.equal(app.state.writes, 0);
    assert.match(tab.elements["#export-error"].textContent, /Couldn’t start the export download/);
    tab.flushDownloadCleanup();
    assert.equal(tab.revoked.length, failure === "click" ? 1 : 0);
  }
});

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

test("legacy records receive distinct persisted IDs without changing fields, order, or existing IDs", () => {
  const legacy = { name: "Same name", status: "Planned", nextAction: "", extra: { keep: true } };
  const original = [existing, legacy, legacy];
  const app = browser(original);
  const a = app.tab();
  const migrated = JSON.parse(app.state.saved);
  assert.deepEqual(migrated[0], existing);
  assert.equal(new Set(migrated.map(project => project.id)).size, 3);
  for (const project of migrated.slice(1)) {
    assert.equal(typeof project.id, "string");
    const { id, ...fields } = project;
    assert.deepEqual(fields, legacy);
  }
  assert.equal(app.state.writes, 1);
  const saved = app.state.saved;
  assert.deepEqual(app.tab().names(), a.names());
  assert.equal(app.state.saved, saved);
  assert.equal(app.state.writes, 1, "Already-migrated data must not be rewritten on load");
});

test("failed ID migration preserves the original data and shows an error; refresh can retry", () => {
  const app = browser([{ name: "Legacy", status: "Done", nextAction: "Keep this" }]);
  const saved = app.state.saved;
  app.state.failWrite = true;
  const tab = app.tab();
  assert.equal(app.state.saved, saved);
  assert.equal(app.state.writes, 0);
  assert.deepEqual(tab.names(), []);
  assert.match(tab.elements["#error-message"].textContent, /couldn’t be loaded or prepared/);
  app.state.failWrite = false;
  assert.deepEqual(app.tab().names(), ["Legacy"]);
  assert.ok(JSON.parse(app.state.saved)[0].id);
});

test("invalid and duplicate IDs are rejected without rewriting stored data", () => {
  for (const records of [[existing, existing], [{ ...existing, id: " " }], [{ ...existing, id: null }]]) {
    const app = browser(records);
    const saved = app.state.saved;
    const tab = app.tab();
    assert.deepEqual(tab.names(), []);
    assert.ok(tab.elements["#error-message"].textContent);
    tab.draft("Do not overwrite");
    tab.submit();
    assert.equal(app.state.saved, saved);
    assert.equal(app.state.writes, 0);
  }
});

test("Cancel leaves storage, list, draft, and feedback unchanged", () => {
  const app = browser();
  const tab = app.tab();
  tab.draft("My draft");
  tab.elements["#success-message"].textContent = "Previous message";
  const saved = app.state.saved;
  const button = tab.deleteButton();
  assert.equal(button.textContent, "Delete");
  assert.equal(button.type, "button");
  assert.equal(button["aria-label"], "Delete project: Existing project");
  tab.confirmation.answer = false;
  app.state.failRead = true; // Cancel must not even attempt a storage read.
  tab.remove();
  assert.equal(tab.confirmation.messages.length, 1);
  assert.match(tab.confirmation.messages[0], /Existing project/);
  assert.equal(app.state.saved, saved);
  assert.equal(app.state.writes, 0);
  assert.deepEqual(tab.names(), ["Existing project"]);
  assert.equal(tab.elements["#project-name"].value, "My draft");
  assert.equal(tab.elements["#success-message"].textContent, "Previous message");
  assert.equal(tab.elements["#error-message"].textContent, "");
});

test("deleting one of two identical legacy records removes only its ID and persists after reload", () => {
  const duplicate = { name: "Identical", status: "Planned", nextAction: "Same action" };
  const app = browser([duplicate, duplicate, existing]);
  const tab = app.tab();
  tab.draft("Keep my draft");
  const before = JSON.parse(app.state.saved);
  tab.remove(1);
  assert.deepEqual(JSON.parse(app.state.saved), [before[0], existing]);
  assert.deepEqual(app.tab().names(), ["Identical", "Existing project"]);
  assert.equal(tab.elements["#project-name"].value, "Keep my draft");
  assert.equal(tab.elements["#project-status"].value, "In progress");
  assert.equal(tab.elements["#next-action"].value, "Keep typing");
  assert.match(tab.elements["#success-message"].textContent, /Project deleted/);
});

test("deletion rereads after confirmation, preserving a new project from another tab", () => {
  const app = browser();
  const a = app.tab();
  const b = app.tab();
  b.confirmation.onConfirm = () => {
    a.draft("Added during confirmation");
    a.submit();
  };
  b.remove();
  assert.deepEqual(JSON.parse(app.state.saved).map(project => project.name), ["Added during confirmation"]);
  a.draft("Draft in other tab");
  a.storageEvent();
  assert.deepEqual(a.names(), ["Added during confirmation"]);
  assert.equal(a.elements["#project-name"].value, "Draft in other tab");
});

test("a stale add does not resurrect a deleted project", () => {
  const app = browser();
  const a = app.tab();
  const b = app.tab();
  a.remove();
  assert.deepEqual(a.names(), []);
  assert.equal(a.elements["#empty-state"].hidden, false);
  assert.deepEqual(app.tab().names(), []);
  b.draft("New project");
  b.submit();
  assert.deepEqual(JSON.parse(app.state.saved).map(project => project.name), ["New project"]);
});

test("deleting a project already removed in another tab does not delete its former neighbor", () => {
  const neighbor = { ...existing, id: "neighbor" };
  const app = browser([existing, neighbor]);
  const a = app.tab();
  const b = app.tab();
  a.remove();
  const saved = app.state.saved;
  const writes = app.state.writes;
  b.remove();
  assert.equal(app.state.saved, saved);
  assert.equal(app.state.writes, writes);
  assert.deepEqual(JSON.parse(app.state.saved), [neighbor]);
  assert.deepEqual(b.names(), ["Existing project"]);
  assert.match(b.elements["#success-message"].textContent, /no longer available/);
});

test("deletion read/write failures leave the project and draft intact with a visible error", () => {
  for (const failure of ["read", "write", "invalid JSON", "duplicate IDs"]) {
    const app = browser();
    const tab = app.tab();
    tab.draft("Keep my draft");
    if (failure === "read") app.state.failRead = true;
    if (failure === "write") app.state.failWrite = true;
    if (failure === "invalid JSON") app.state.saved = "broken JSON";
    if (failure === "duplicate IDs") app.state.saved = JSON.stringify([existing, existing]);
    const saved = app.state.saved;
    tab.remove();
    assert.equal(app.state.saved, saved);
    assert.equal(app.state.writes, 0);
    assert.deepEqual(tab.names(), ["Existing project"]);
    assert.equal(tab.elements["#project-name"].value, "Keep my draft");
    assert.match(tab.elements["#error-message"].textContent, /Couldn’t delete/);
    assert.equal(tab.elements["#success-message"].textContent, "");
    app.state.failRead = false;
    app.state.failWrite = false;
    app.state.saved = JSON.stringify([existing]);
    tab.remove();
    assert.deepEqual(JSON.parse(app.state.saved), []);
    assert.equal(tab.elements["#error-message"].textContent, "");
  }
});

test("editing prefills all fields, preserves ID and extra fields, and persists after reload", () => {
  const original = { ...existing, extra: { keep: true } };
  const app = browser([original]);
  const tab = app.tab();
  tab.draft("Unfinished addition");
  tab.edit();
  assert.equal(tab.elements["#cancel-edit"].hidden, false);
  assert.equal(tab.elements["#project-name"].value, existing.name);
  assert.equal(tab.elements["#project-status"].value, existing.status);
  assert.equal(tab.elements["#next-action"].value, existing.nextAction);
  for (const status of ["Planned", "In progress", "Done"]) {
    tab.editDraft("  <b>Updated name</b>  ", status, "  <script>literal text</script>  ");
    tab.saveEdit();
    assert.deepEqual(JSON.parse(app.state.saved), [{
      ...original, name: "<b>Updated name</b>", status, nextAction: "<script>literal text</script>",
    }]);
    assert.deepEqual(tab.names(), ["<b>Updated name</b>"]);
    assert.deepEqual(app.tab().names(), tab.names());
    assert.equal(tab.elements["#cancel-edit"].hidden, true);
    assert.equal(tab.elements["#project-name"].value, "Unfinished addition");
    tab.edit();
  }
  tab.editDraft("No next step", "Planned", "   ");
  tab.saveEdit();
  assert.equal(JSON.parse(app.state.saved)[0].nextAction, "");
});

test("canceling an edit does not read or write storage and preserves the add draft", () => {
  const app = browser();
  const tab = app.tab();
  tab.draft("Unfinished addition");
  tab.edit();
  tab.editDraft("Unsaved edit");
  const saved = app.state.saved;
  app.state.failRead = true;
  app.state.failWrite = true;
  tab.cancelEdit();
  assert.equal(app.state.saved, saved);
  assert.equal(app.state.writes, 0);
  assert.deepEqual(tab.names(), [existing.name]);
  assert.equal(tab.elements["#cancel-edit"].hidden, true);
  assert.equal(tab.elements["#error-message"].textContent, "");
  assert.equal(tab.elements["#project-name"].value, "Unfinished addition");
  tab.edit();
  assert.equal(tab.elements["#project-name"].value, existing.name);
});

test("editing one of two identically named projects changes only the selected stable ID", () => {
  const duplicate = { ...existing, id: "duplicate" };
  const app = browser([existing, duplicate]);
  const tab = app.tab();
  tab.edit(1);
  // Simulate a reordered latest list without delivering a storage event.
  app.state.saved = JSON.stringify([duplicate, existing]);
  tab.editDraft("Selected project");
  tab.saveEdit();
  assert.deepEqual(JSON.parse(app.state.saved), [
    { ...duplicate, name: "Selected project", status: "In progress", nextAction: "Edited next step" }, existing,
  ]);
});

test("edit validation rejects blank names and invalid statuses, then allows correction", () => {
  const app = browser();
  const tab = app.tab();
  const saved = app.state.saved;
  tab.edit();
  for (const name of ["", "   ", "\t\n", "\u00a0"]) {
    tab.editDraft(name);
    tab.saveEdit();
    assert.equal(app.state.saved, saved);
    assert.equal(app.state.writes, 0);
    assert.equal(tab.elements["#project-name"].value, name);
    assert.match(tab.elements["#project-name"].validationMessage, /project name/);
    assert.equal(tab.elements["#project-name"].validityReported, true);
  }
  tab.editDraft("Valid", "Unknown");
  tab.saveEdit();
  assert.equal(app.state.writes, 0);
  assert.match(tab.elements["#error-message"].textContent, /status/);
  tab.editDraft("Corrected");
  assert.equal(tab.elements["#project-name"].validationMessage, "");
  tab.saveEdit();
  assert.equal(JSON.parse(app.state.saved)[0].name, "Corrected");
});

test("a stale edit preserves another tab's unrelated edit, addition, and deletion", () => {
  const other = { ...existing, id: "other", name: "Other" };
  const removed = { ...existing, id: "removed", name: "Remove me" };
  const app = browser([existing, other, removed]);
  const a = app.tab();
  const b = app.tab();
  b.edit();
  b.editDraft("B edit");
  a.edit(1);
  a.editDraft("A edit", "Planned", "A next action");
  a.saveEdit();
  a.remove(2);
  a.draft("A addition");
  a.submit();
  const latest = JSON.parse(app.state.saved);
  b.saveEdit();
  const saved = JSON.parse(app.state.saved);
  assert.equal(saved[0].name, "B edit");
  assert.deepEqual(saved.slice(1), latest.slice(1));
  a.storageEvent();
  assert.deepEqual(a.names(), ["B edit", "A edit", "A addition"]);
});

test("storage events and attempts to start another edit do not replace an edit draft", () => {
  const app = browser([existing, { ...existing, id: "other" }]);
  const a = app.tab();
  const b = app.tab();
  b.edit();
  b.editDraft("Keep my edit", "Planned", "Keep my next action");
  a.draft("Added elsewhere");
  a.submit();
  b.storageEvent();
  b.edit(1);
  assert.equal(b.elements["#project-name"].value, "Keep my edit");
  assert.equal(b.elements["#project-status"].value, "Planned");
  assert.equal(b.elements["#next-action"].value, "Keep my next action");
  assert.match(b.elements["#error-message"].textContent, /Save or cancel/);
  b.saveEdit();
  assert.equal(JSON.parse(app.state.saved)[0].name, "Keep my edit");
});

test("saving after another tab deletes the project never recreates it, with or without an event", () => {
  for (const deliverEvent of [false, true]) {
    const app = browser();
    const a = app.tab();
    const b = app.tab();
    b.edit();
    b.editDraft("Do not recreate");
    a.remove();
    if (deliverEvent) b.storageEvent();
    const writes = app.state.writes;
    b.saveEdit();
    assert.equal(app.state.writes, writes);
    assert.deepEqual(JSON.parse(app.state.saved), []);
    assert.deepEqual(b.names(), []);
    assert.equal(b.elements["#project-name"].value, "Do not recreate");
    assert.equal(b.elements["#cancel-edit"].hidden, false);
    assert.match(b.elements["#error-message"].textContent, /deleted or is no longer available/);
    b.cancelEdit();
    assert.equal(b.elements["#cancel-edit"].hidden, true);
  }
});

test("edit storage failures preserve the entire draft and saved list; retry updates without duplication", () => {
  for (const failure of ["read", "write", "invalid JSON", "invalid data"]) {
    const app = browser();
    const tab = app.tab();
    tab.edit();
    tab.editDraft("Keep this name", "Planned", "Keep this action");
    if (failure === "read") app.state.failRead = true;
    if (failure === "write") app.state.failWrite = true;
    if (failure === "invalid JSON") app.state.saved = "broken JSON";
    if (failure === "invalid data") app.state.saved = JSON.stringify([existing, existing]);
    const saved = app.state.saved;
    tab.saveEdit();
    assert.equal(app.state.saved, saved);
    assert.equal(app.state.writes, 0);
    assert.deepEqual(tab.names(), [existing.name]);
    assert.equal(tab.elements["#project-name"].value, "Keep this name");
    assert.equal(tab.elements["#project-status"].value, "Planned");
    assert.equal(tab.elements["#next-action"].value, "Keep this action");
    assert.equal(tab.elements["#cancel-edit"].hidden, false);
    assert.match(tab.elements["#error-message"].textContent, /Couldn’t save your changes/);
    app.state.failRead = false;
    app.state.failWrite = false;
    app.state.saved = JSON.stringify([existing]);
    tab.saveEdit();
    assert.deepEqual(JSON.parse(app.state.saved), [{ ...existing, name: "Keep this name", status: "Planned", nextAction: "Keep this action" }]);
    assert.equal(tab.elements["#cancel-edit"].hidden, true);
    assert.equal(tab.elements["#error-message"].textContent, "");
  }
});

test("shared form changes modes and restores every Add field after save or cancel", () => {
  for (const finish of ["save", "cancel"]) {
    const app = browser();
    const tab = app.tab();
    const controls = tab.elements;
    assert.equal(controls["#form-heading"].textContent, "Add project");
    assert.equal(controls["#submit-project"].textContent, "Add project");
    assert.equal(controls["#cancel-edit"].hidden, true);
    assert.equal(controls["#project-status"].value, "Planned");
    tab.draft("  Unfinished addition  ");
    controls["#project-status"].value = "Done";
    controls["#next-action"].value = "  Original next step  ";
    tab.edit();
    assert.equal(controls["#form-heading"].textContent, "Edit project");
    assert.equal(controls["#submit-project"].textContent, "Save changes");
    assert.equal(controls["#cancel-edit"].hidden, false);
    assert.equal(tab.activeElement(), controls["#project-name"]);
    tab.editDraft("Updated", "Planned", "Updated action");
    app.state.failWrite = true;
    tab.saveEdit();
    assert.equal(controls["#form-heading"].textContent, "Edit project");
    assert.equal(controls["#submit-project"].textContent, "Save changes");
    assert.equal(controls["#project-name"].value, "Updated");
    app.state.failWrite = false;
    if (finish === "save") tab.saveEdit();
    else tab.cancelEdit();
    assert.equal(controls["#form-heading"].textContent, "Add project");
    assert.equal(controls["#submit-project"].textContent, "Add project");
    assert.equal(controls["#cancel-edit"].hidden, true);
    assert.equal(controls["#error-message"].textContent, "");
    assert.equal(controls["#project-name"].value, "  Unfinished addition  ");
    assert.equal(controls["#project-status"].value, "Done");
    assert.equal(controls["#next-action"].value, "  Original next step  ");
    const edited = JSON.parse(app.state.saved)[0];
    assert.equal(edited.name, finish === "save" ? "Updated" : existing.name);
    assert.equal(app.state.writes, finish === "save" ? 1 : 0);
    // Submitting the restored Add draft must create a new ID, not edit the old one.
    tab.submit();
    const saved = JSON.parse(app.state.saved);
    assert.equal(saved.length, 2);
    assert.deepEqual(saved[0], edited);
    assert.notEqual(saved[1].id, existing.id);
    assert.equal(saved[1].name, "Unfinished addition");
    assert.equal(saved[1].status, "Done");
    assert.equal(saved[1].nextAction, "Original next step");
  }
});

test("validation state does not leak between Add and Edit modes", () => {
  const app = browser();
  const tab = app.tab();
  tab.draft("   ");
  tab.submit();
  assert.ok(tab.elements["#project-name"].validationMessage);
  tab.edit();
  assert.equal(tab.elements["#project-name"].validationMessage, "");
  tab.editDraft("\t");
  tab.saveEdit();
  assert.ok(tab.elements["#project-name"].validationMessage);
  tab.cancelEdit();
  assert.equal(tab.elements["#project-name"].validationMessage, "");
  assert.equal(tab.elements["#project-name"].value, "   ");
  tab.submit();
  assert.equal(app.state.writes, 0);
  assert.ok(tab.elements["#project-name"].validationMessage);
});

test("tab updates preserve both the active edit and the suspended Add draft", () => {
  const app = browser();
  const a = app.tab();
  const b = app.tab();
  b.draft("My Add draft");
  b.edit();
  b.editDraft("My edit", "Done", "Edit next action");
  a.draft("Other tab addition");
  a.submit();
  b.storageEvent();
  assert.equal(b.elements["#project-name"].value, "My edit");
  assert.equal(b.elements["#project-status"].value, "Done");
  assert.equal(b.elements["#next-action"].value, "Edit next action");
  b.edit(1); // A second Edit click must not replace either draft.
  b.cancelEdit();
  assert.equal(b.elements["#project-name"].value, "My Add draft");
  assert.equal(b.elements["#project-status"].value, "In progress");
  assert.equal(b.elements["#next-action"].value, "Keep typing");
  assert.deepEqual(b.names(), [existing.name, "Other tab addition"]);
});

const sampleSuggestions = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/project-suggestions.json"), "utf8"));

test("suggestions fetch the static file without caching and replace safely rendered results", async () => {
  const app = browser();
  const tab = app.tab();
  assert.equal(tab.requests.length, 0, "Loading must require a click");
  const literal = { name: "<img src=x onerror=alert(1)>", nextAction: "<script>alert(1)</script>" };
  tab.network.respond = async () => ({ ok: true, json: async () => [...sampleSuggestions, literal] });
  for (let attempt = 0; attempt < 2; attempt++) {
    await tab.loadSuggestions();
    const items = tab.elements["#suggestions-list"].children;
    assert.equal(items.length, 3);
    assert.deepEqual(items.map(item => item.children.map(child => child.textContent)),
      [...sampleSuggestions, literal].map(item => [item.name, item.nextAction]));
    assert.equal(items[2].children[0].children.length, 0, "Markup stays plain text");
    assert.equal(items[2].children[1].children.length, 0);
    assert.equal(tab.elements["#load-suggestions"].disabled, false);
    assert.equal(tab.elements["#suggestions-error"].textContent, "");
  }
  assert.equal(tab.requests.length, 2);
  for (const request of tab.requests) {
    assert.equal(request.url, "./data/project-suggestions.json");
    assert.equal(request.options.cache, "no-store");
  }
  assert.equal(app.state.writes, 0);
});

test("suggestions stay loading through both request and JSON reading and ignore concurrent clicks", async () => {
  const tab = browser().tab();
  let resolveRequest;
  let resolveJson;
  const json = new Promise(resolve => { resolveJson = resolve; });
  tab.network.respond = () => new Promise(resolve => { resolveRequest = resolve; });
  const loading = tab.loadSuggestions();
  assert.equal(tab.elements["#suggestions-message"].textContent, "Loading suggestions…");
  assert.equal(tab.elements["#load-suggestions"].disabled, true);
  await tab.loadSuggestions();
  assert.equal(tab.requests.length, 1);
  resolveRequest({ ok: true, json: () => json });
  await Promise.resolve();
  assert.equal(tab.elements["#load-suggestions"].disabled, true);
  resolveJson(sampleSuggestions);
  await loading;
  assert.equal(tab.elements["#load-suggestions"].disabled, false);
  assert.equal(tab.elements["#suggestions-list"].children.length, 2);
});

test("empty suggestions replace previous results with an informative message", async () => {
  const tab = browser().tab();
  tab.network.respond = async () => ({ ok: true, json: async () => sampleSuggestions });
  await tab.loadSuggestions();
  tab.network.respond = async () => ({ ok: true, json: async () => [] });
  await tab.loadSuggestions();
  assert.equal(tab.elements["#suggestions-list"].children.length, 0);
  assert.equal(tab.elements["#suggestions-message"].textContent, "No suggestions available.");
  assert.equal(tab.elements["#suggestions-error"].textContent, "");
});

test("HTTP, network, JSON, and validation failures allow a successful retry", async (t) => {
  let httpJsonRead = false;
  const failures = [
    ["HTTP", async () => ({ ok: false, status: 404, json() { httpJsonRead = true; return sampleSuggestions; } })],
    ["network", async () => { throw new TypeError("Failed to fetch"); }],
    ["JSON", async () => ({ ok: true, json: async () => { throw new SyntaxError("Invalid JSON"); } })],
    ...[null, {}, [null], ["idea"], [{ name: " ", nextAction: "Do it" }],
      [{ name: 12, nextAction: "Do it" }], [{ name: "Idea" }],
      [{ name: "Idea", nextAction: "\n\t" }], [{ name: "Idea", nextAction: 1 }],
      [sampleSuggestions[0], { name: "Invalid later record" }]
    ].map((value, index) => [`validation ${index}`, async () => ({ ok: true, json: async () => value })]),
  ];
  for (const [label, respond] of failures) {
    await t.test(label, async () => {
      const tab = browser().tab();
      tab.network.respond = respond;
      await tab.loadSuggestions();
      assert.equal(httpJsonRead, false, "HTTP failures must be checked before reading JSON");
      assert.equal(tab.elements["#suggestions-list"].children.length, 0);
      assert.equal(tab.elements["#suggestions-message"].textContent, "");
      assert.match(tab.elements["#suggestions-error"].textContent, /Couldn’t load suggestions.*try Load suggestions again/);
      assert.equal(tab.elements["#load-suggestions"].disabled, false);
      tab.network.respond = async () => ({ ok: true, json: async () => sampleSuggestions });
      await tab.loadSuggestions();
      assert.equal(tab.elements["#suggestions-list"].children.length, 2);
      assert.equal(tab.elements["#suggestions-error"].textContent, "");
    });
  }
});

test("suggestions success and failure leave saved projects, Add/Edit drafts, and form feedback intact", async () => {
  const app = browser();
  const tab = app.tab();
  const saved = app.state.saved;
  tab.draft("Unfinished Add");
  for (const editing of [false, true]) {
    if (editing) {
      tab.edit();
      tab.editDraft("Unfinished Edit", "Done", "Edit next action");
    }
    const fields = ["#project-name", "#project-status", "#next-action", "#form-heading"];
    const before = fields.map(id => [tab.elements[id].value, tab.elements[id].textContent]);
    tab.elements["#error-message"].textContent = "Keep form error";
    tab.elements["#success-message"].textContent = "Keep form feedback";
    app.state.failRead = true;
    app.state.failWrite = true;
    for (const fail of [false, true]) {
      tab.network.respond = async () => {
        if (fail) throw new Error("Offline");
        return { ok: true, json: async () => sampleSuggestions };
      };
      await tab.loadSuggestions();
      assert.deepEqual(fields.map(id => [tab.elements[id].value, tab.elements[id].textContent]), before);
      assert.equal(tab.elements["#error-message"].textContent, "Keep form error");
      assert.equal(tab.elements["#success-message"].textContent, "Keep form feedback");
      assert.equal(app.state.saved, saved);
      assert.equal(app.state.writes, 0);
      assert.deepEqual(tab.names(), [existing.name]);
    }
    app.state.failRead = false;
    app.state.failWrite = false;
  }
  tab.cancelEdit();
  assert.equal(tab.elements["#project-name"].value, "Unfinished Add");
  assert.equal(tab.elements["#project-status"].value, "In progress");
  assert.equal(tab.elements["#next-action"].value, "Keep typing");
});
