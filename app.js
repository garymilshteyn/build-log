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

  return savedProjects;
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
    // Retry a failed read before writing so unreadable saved data is preserved.
    if (!storageLoaded) {
      projects = readProjects();
      storageLoaded = true;
      renderProjects();
    }
    const updatedProjects = [...projects, project];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedProjects));
    projects = updatedProjects;
  } catch {
    errorMessage.textContent = storageLoaded
      ? "Couldn’t save this project. Check that your browser allows site storage and has space available, then try again. Your entry is still in the form."
      : "Couldn’t save because existing projects couldn’t be read. Check your browser’s site storage settings and reload to try again. Copy your entry before reloading; it has not been saved. Existing stored data has not been changed.";
    return;
  }

  renderProjects();
  form.reset();
  errorMessage.textContent = "";
  successMessage.textContent = "Project added and saved in this browser.";
  nameInput.focus();
});

try {
  projects = readProjects();
  storageLoaded = true;
} catch {
  errorMessage.textContent = "Saved projects couldn’t be loaded. Browser storage may be blocked or the saved data may be damaged. Reload to try again. Existing stored data has not been changed.";
}

renderProjects();
