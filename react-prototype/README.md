# Build Log React lesson — milestone 1

An isolated React prototype: add projects and display them using component props and React state. Projects exist only in memory and disappear on refresh. There is no database or browser storage.

## Run

Use Node.js 22.19+ (or Node.js 24 LTS) and npm. From the repository root:

```sh
cd react-prototype
npm ci
npm run dev
```

Open the local URL printed by Vite, normally http://127.0.0.1:5173. Stop with Ctrl+C. The original static app still runs separately using the root README's Python server instructions.

## Follow the data

- `App` receives no props. It owns the `projects` array in `useState([])` so the form and list share one source of truth.
- `ProjectForm` receives `onAddProject`, a callback from `App`. The form owns its draft name, status, next action, and validation message as local state. Each input has a matching label.
- `ProjectList` receives the `projects` array. It maps each project to a `ProjectItem` with `key={project.id}`. React uses this stable key to identify the item; `key` is not passed as a component prop.
- `ProjectItem` receives one `project` object with `id`, `name`, `status`, and `nextAction`, and displays its fields as text.

Submitting prevents the browser's page reload, trims the name, and rejects whitespace-only names; the required input also blocks empty names. A valid submission calls `onAddProject`. `App` creates a UUID once and appends the project with `setProjects(currentProjects => [...currentProjects, project])`, preserving existing objects and IDs. React renders the updated array through `ProjectList`. The form then resets its draft. Duplicate names are allowed and receive distinct IDs.

## Checks

From the repository root:

```sh
npm --prefix react-prototype run lint
npm --prefix react-prototype run build
node --test tests/app.test.cjs
```

The last command checks the existing static app. For a manual React check, add two projects with the same name and different statuses/actions, try empty and spaces-only names, and confirm a refresh clears the prototype list.
