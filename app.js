"use strict";

const STORAGE_KEY = "build-log.projects";
const statusClasses = new Map([
  ["Planned", "status-planned"],
  ["In progress", "status-in-progress"],
  ["Done", "status-done"],
]);

const form = document.querySelector("#project-form");
const nameInput = document.querySelector("#project-name");
const statusInput = document.querySelector("#project-status");
const nextActionInput = document.querySelector("#next-action");
const projectList = document.querySelector("#project-list");
const emptyState = document.querySelector("#empty-state");
const errorMessage = document.querySelector("#error-message");
const successMessage = document.querySelector("#success-message");
const formHeading = document.querySelector("#form-heading");
const submitButton = document.querySelector("#submit-project");
const cancelEditButton = document.querySelector("#cancel-edit");
const exportButton = document.querySelector("#export-projects");
const exportError = document.querySelector("#export-error");
const exportMessage = document.querySelector("#export-message");
const importButton = document.querySelector("#import-projects");
const importFile = document.querySelector("#import-file");
const importPreview = document.querySelector("#import-preview");
const importSummary = document.querySelector("#import-summary");
const confirmImportButton = document.querySelector("#confirm-import");
const cancelImportButton = document.querySelector("#cancel-import");
const importError = document.querySelector("#import-error");
const importMessage = document.querySelector("#import-message");

let projects = [];
let storageLoaded = false;
let editingId = null;
let addDraft = null;
let pendingImport = null;
let importReadVersion = 0;

function validateProjects(savedProjects, { requireIds = false } = {}) {
  const isValidProject = (project) =>
    project !== null &&
    typeof project === "object" &&
    typeof project.name === "string" &&
    project.name.trim() !== "" &&
    statusClasses.has(project.status) &&
    typeof project.nextAction === "string";

  if (!Array.isArray(savedProjects) || !savedProjects.every(isValidProject)) {
    throw new Error("Expected an array of projects with nonblank names, valid statuses, and string nextAction fields.");
  }

  const ids = new Set();
  for (const project of savedProjects) {
    if (project.id === undefined && !requireIds) continue;
    if (typeof project.id !== "string" || !project.id.trim() || ids.has(project.id)) {
      throw new Error("Every project must have a unique, nonempty string ID.");
    }
    ids.add(project.id);
  }
  return ids;
}

function readProjects({ migrateIds = true } = {}) {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === null) return [];

  const savedProjects = JSON.parse(stored);
  const ids = validateProjects(savedProjects);

  // Persist IDs before rendering so refreshed and stale tabs identify the same records.
  // Keep every existing field, including fields this version does not use.
  if (savedProjects.some((project) => project.id === undefined)) {
    if (!migrateIds) throw new Error("Saved projects need ID migration first.");
    const migratedProjects = savedProjects.map((project) =>
      project.id === undefined ? { ...project, id: createProjectId(ids) } : project
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migratedProjects));
    return migratedProjects;
  }

  return savedProjects;
}

function exportProjects() {
  exportError.textContent = "";
  exportMessage.textContent = "";
  let savedProjects;
  try {
    // Export must never write to storage, even when legacy records need IDs.
    savedProjects = readProjects({ migrateIds: false });
  } catch {
    exportError.textContent = "Couldn’t read saved projects for export. Storage may be blocked, the data may be invalid, or older projects may still need IDs. Check site storage and reload to retry; copy any drafts before reloading. No backup was downloaded.";
    return;
  }

  let objectUrl;
  let link;
  try {
    const now = new Date();
    const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
    const backup = new Blob([JSON.stringify(savedProjects, null, 2)], { type: "application/json" });
    objectUrl = URL.createObjectURL(backup);
    link = document.createElement("a");
    link.href = objectUrl;
    link.download = `build-log-projects-${date}.json`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    exportMessage.textContent = "Download requested. The backup includes saved projects only.";
  } catch {
    exportError.textContent = "Couldn’t start the export download. Check your browser’s download settings and try again. Your saved projects and drafts have not been changed.";
  } finally {
    if (link) link.remove();
    // Give the browser time to start the download before releasing its URL.
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

exportButton.addEventListener("click", exportProjects);

function mergeImport(savedProjects, importedProjects) {
  const existingIds = new Set(savedProjects.map((project) => project.id));
  const additions = importedProjects.filter((project) => !existingIds.has(project.id));
  return {
    projects: [...savedProjects, ...additions],
    added: additions.length,
    skipped: importedProjects.length - additions.length,
  };
}

importButton.addEventListener("click", () => {
  // Permit choosing the same file again. Canceling the picker leaves app state alone.
  importFile.value = "";
  importFile.click();
});

importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  if (!file) return;
  const version = ++importReadVersion;
  pendingImport = null;
  importPreview.hidden = true;
  importError.textContent = "";
  importMessage.textContent = "Reading backup…";

  let contents;
  try {
    contents = await file.text();
  } catch {
    if (version !== importReadVersion) return;
    importMessage.textContent = "";
    importError.textContent = "Couldn’t read this file. Choose an accessible JSON backup and try again. Nothing was imported.";
    return;
  }
  // An earlier file read must not replace a more recent selection.
  if (version !== importReadVersion) return;
  importMessage.textContent = "";

  let records;
  try {
    records = JSON.parse(contents);
  } catch {
    importError.textContent = "This file is not valid JSON. Choose a Build Log JSON backup. Nothing was imported.";
    return;
  }
  try {
    validateProjects(records, { requireIds: true });
  } catch (error) {
    importError.textContent = `Invalid backup: ${error.message} Nothing was imported.`;
    return;
  }

  // Copy only supported fields; never merge arbitrary file properties into records.
  const importedProjects = records.map(({ id, name, status, nextAction }) => ({ id, name, status, nextAction }));
  try {
    const merge = mergeImport(readProjects({ migrateIds: false }), importedProjects);
    importSummary.textContent = `${merge.added} new project(s) to add; ${merge.skipped} existing ID(s) to skip. Existing projects will be kept unchanged, even if the file has different fields. Counts will be recalculated when you confirm.`;
    pendingImport = importedProjects;
    importPreview.hidden = false;
    confirmImportButton.focus();
  } catch {
    importError.textContent = "Couldn’t read existing projects for the preview. Check site storage; saved data may be invalid or still need ID migration. Nothing was imported. Choose the file again after resolving the problem.";
  }
});

cancelImportButton.addEventListener("click", () => {
  ++importReadVersion;
  pendingImport = null;
  importPreview.hidden = true;
  importError.textContent = "";
  importMessage.textContent = "";
  importButton.focus();
});

confirmImportButton.addEventListener("click", () => {
  if (pendingImport === null) return;
  try {
    // Recompute after the preview, without migrating or overwriting existing IDs.
    // This read/write pair is still not atomic across simultaneous tab writes.
    const merge = mergeImport(readProjects({ migrateIds: false }), pendingImport);
    if (merge.added > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merge.projects));
    }
    projects = merge.projects;
    storageLoaded = true;
    renderProjects();
    pendingImport = null;
    importPreview.hidden = true;
    importError.textContent = "";
    importMessage.textContent = `Imported ${merge.added} new project(s); skipped ${merge.skipped} existing ID(s).`;
    importButton.focus();
  } catch {
    importError.textContent = "Couldn’t import projects. Storage may be blocked, full, or contain invalid data. Nothing was imported; your drafts are unchanged. Check site storage, then confirm again to retry or choose Cancel.";
  }
});

function createProjectId(ids) {
  let id;
  do {
    id = crypto.randomUUID();
  } while (ids.has(id));
  ids.add(id);
  return id;
}

function renderProjects() {
  projectList.replaceChildren();
  emptyState.hidden = projects.length > 0;
  emptyState.textContent = storageLoaded
    ? "No projects yet. Add your first project above."
    : "Your saved projects are currently unavailable.";

  for (const project of projects) {
    const item = document.createElement("li");
    item.className = "project";

    const header = document.createElement("div");
    header.className = "project-header";

    const name = document.createElement("h3");
    name.textContent = project.name;

    const status = document.createElement("span");
    status.className = `status ${statusClasses.get(project.status)}`;
    status.textContent = project.status;
    header.append(name, status);

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-button";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete project: ${project.name}`);
    deleteButton.addEventListener("click", () => deleteProject(project));
    header.append(deleteButton);

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "secondary-button";
    editButton.textContent = "Edit";
    editButton.setAttribute("aria-label", `Edit project: ${project.name}`);
    editButton.addEventListener("click", () => startEditing(project));
    header.append(editButton);
    item.append(header);

    if (project.nextAction) {
      const nextAction = document.createElement("p");
      nextAction.className = "next-action";
      const label = document.createElement("strong");
      label.textContent = "Next: ";
      nextAction.append(label, document.createTextNode(project.nextAction));
      item.append(nextAction);
    }

    projectList.append(item);
  }
}

function startEditing(project) {
  if (editingId !== null) {
    errorMessage.textContent = "Save or cancel your current edit before starting another one.";
    nameInput.focus();
    return;
  }
  // Keep raw input, including whitespace, until the user submits the Add draft.
  addDraft = { name: nameInput.value, status: statusInput.value, nextAction: nextActionInput.value };
  editingId = project.id;
  nameInput.value = project.name;
  statusInput.value = project.status;
  nextActionInput.value = project.nextAction;
  nameInput.setCustomValidity("");
  errorMessage.textContent = "";
  successMessage.textContent = "";
  updateFormMode();
  nameInput.focus();
}

function updateFormMode() {
  const isEditing = editingId !== null;
  formHeading.textContent = isEditing ? "Edit project" : "Add project";
  submitButton.textContent = isEditing ? "Save changes" : "Add project";
  cancelEditButton.hidden = !isEditing;
}

function closeEditor() {
  if (editingId === null) return;
  editingId = null;
  nameInput.value = addDraft.name;
  statusInput.value = addDraft.status;
  nextActionInput.value = addDraft.nextAction;
  addDraft = null;
  nameInput.setCustomValidity("");
  errorMessage.textContent = "";
  successMessage.textContent = "";
  updateFormMode();
  nameInput.focus();
}

cancelEditButton.addEventListener("click", closeEditor);

function saveEdits(changes) {
  try {
    // Apply only this edit to the latest list, preserving other tabs' changes.
    // As with additions and deletions, this read/write pair is not atomic.
    const latestProjects = readProjects();
    if (!latestProjects.some((project) => project.id === editingId)) {
      projects = latestProjects;
      storageLoaded = true;
      renderProjects();
      errorMessage.textContent = "This project was deleted or is no longer available. Your changes were not saved. Copy your draft if needed, then choose Cancel.";
      return;
    }
    const updatedProjects = latestProjects.map((project) => project.id === editingId
      ? { ...project, ...changes }
      : project);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedProjects));
    projects = updatedProjects;
    storageLoaded = true;
  } catch {
    errorMessage.textContent = "Couldn’t save your changes. Browser storage may be blocked, full, or contain invalid data. Your edit draft is still here; check site storage and try again.";
    return;
  }

  renderProjects();
  closeEditor();
  successMessage.textContent = "Project updated and saved in this browser.";
}

function deleteProject(project) {
  if (!window.confirm(`Delete project "${project.name}"? This cannot be undone.`)) return;

  successMessage.textContent = "";
  try {
    // Reread after confirmation: another tab may have added or deleted a project.
    const latestProjects = readProjects();
    const updatedProjects = latestProjects.filter((saved) => saved.id !== project.id);
    const removed = updatedProjects.length !== latestProjects.length;
    if (removed) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedProjects));
    }
    projects = updatedProjects;
    storageLoaded = true;
    renderProjects();
    errorMessage.textContent = "";
    successMessage.textContent = removed
      ? "Project deleted and saved in this browser."
      : "This project is no longer available to delete. The list has been refreshed.";
    nameInput.focus();
  } catch {
    errorMessage.textContent = "Couldn’t delete this project. Browser storage may be blocked, full, or contain invalid data. Nothing was deleted. Check site storage and try again. Your form entry has not been changed.";
  }
}

nameInput.addEventListener("input", () => {
  nameInput.setCustomValidity("");
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  successMessage.textContent = "";

  const name = nameInput.value.trim();
  if (!name) {
    nameInput.setCustomValidity("Enter a project name, not just spaces.");
    nameInput.reportValidity();
    return;
  }

  if (!statusClasses.has(statusInput.value)) {
    errorMessage.textContent = "Choose a project status from the list.";
    return;
  }

  const project = {
    name,
    status: statusInput.value,
    nextAction: nextActionInput.value.trim(),
  };

  if (editingId !== null) {
    saveEdits(project);
    return;
  }

  try {
    // Read on every submission, even if another tab's storage event is still pending.
    // This read/write pair is not atomic; simultaneous writes can still conflict.
    storageLoaded = false;
    projects = readProjects();
    storageLoaded = true;
    renderProjects();
    project.id = createProjectId(new Set(projects.map((saved) => saved.id)));
    const updatedProjects = [...projects, project];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedProjects));
    projects = updatedProjects;
  } catch {
    errorMessage.textContent = storageLoaded
      ? "Couldn’t save this project. Check that your browser allows site storage and has space available, then try again. Your entry is still in the form."
      : "Couldn’t save because existing projects couldn’t be read or prepared. Check your browser’s site storage settings and reload to try again. Copy your entry before reloading; it has not been saved. Existing stored data has not been changed.";
    return;
  }

  renderProjects();
  form.reset();
  errorMessage.textContent = "";
  successMessage.textContent = "Project added and saved in this browser.";
  nameInput.focus();
});

window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;

  try {
    if (event.storageArea !== localStorage) return;
    // Read current storage rather than a potentially outdated event payload.
    projects = readProjects();
    storageLoaded = true;
    renderProjects();
  } catch {
    errorMessage.textContent = "Saved projects couldn’t be refreshed. The displayed list may be out of date. Your form entry has not been changed.";
  }
});

updateFormMode();

try {
  projects = readProjects();
  storageLoaded = true;
} catch {
  errorMessage.textContent = "Saved projects couldn’t be loaded or prepared. Browser storage may be blocked, full, or contain invalid data. Reload to try again. Existing stored data has not been changed.";
}

renderProjects();
