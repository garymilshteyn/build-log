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

let projects = [];
let storageLoaded = false;

function readProjects() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === null) return [];

  const savedProjects = JSON.parse(stored);
  const isValidProject = (project) =>
    project !== null &&
    typeof project === "object" &&
    typeof project.name === "string" &&
    project.name.trim() !== "" &&
    statusClasses.has(project.status) &&
    typeof project.nextAction === "string";

  if (!Array.isArray(savedProjects) || !savedProjects.every(isValidProject)) {
    throw new Error("Saved projects have an invalid format.");
  }

  const ids = new Set();
  for (const project of savedProjects) {
    if (project.id === undefined) continue;
    if (typeof project.id !== "string" || !project.id.trim() || ids.has(project.id)) {
      throw new Error("Saved projects have invalid or duplicate IDs.");
    }
    ids.add(project.id);
  }

  // Persist IDs before rendering so refreshed and stale tabs identify the same records.
  // Keep every existing field, including fields this version does not use.
  if (savedProjects.some((project) => project.id === undefined)) {
    const migratedProjects = savedProjects.map((project) =>
      project.id === undefined ? { ...project, id: createProjectId(ids) } : project
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migratedProjects));
    return migratedProjects;
  }

  return savedProjects;
}

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

try {
  projects = readProjects();
  storageLoaded = true;
} catch {
  errorMessage.textContent = "Saved projects couldn’t be loaded or prepared. Browser storage may be blocked, full, or contain invalid data. Reload to try again. Existing stored data has not been changed.";
}

renderProjects();
