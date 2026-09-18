# Build Log

An app for organizing my software projects and their next actions.

## First version
- Add a project with a required name, a status (Planned, In progress, or Done), and an optional next action.
- View projects in a responsive list.
- Keep projects after refreshing using localStorage in the same browser.
- Reject blank names and display entered content as text.
- Keep the form entry and show a message if saving fails.
- Delete an individual project after confirmation, including when projects have identical names.

## Run locally

Prerequisite: Python 3. No packages or build step are needed.

1. Open a terminal in the `build-log` repository folder.
2. Run:

   ```sh
   python3 -m http.server 8000 --bind 127.0.0.1
   ```

3. Open **http://127.0.0.1:8000** in your browser.
4. To stop the server, press **Ctrl+C** in the terminal.

This server only serves the static files; there is no application backend. Use the same browser and URL (including port) to return to your saved projects. Projects stay on this browser only; clearing its site data removes them. Opening `index.html` directly is not recommended because localStorage behavior for file URLs varies by browser.

Each addition or confirmed deletion rereads the latest stored projects, and other open tabs update their lists when storage changes without clearing their forms. This preserves sequential changes from stale tabs. Truly simultaneous writes (including initial ID migration) can still conflict because the localStorage read and write are not one atomic operation.

Projects have stable IDs so deletion targets a single record, not a name or list position. Existing records without IDs receive them automatically, preserving their fields and order. IDs are saved before those projects are displayed; if this migration cannot be saved, an error appears and the original stored data remains untouched. Invalid or duplicate IDs are rejected rather than risking deletion of the wrong record. ID generation uses the browser's `crypto.randomUUID()`; use a modern browser at the local URL above (or HTTPS).

## Files

- `index.html`: Page structure, labeled project form, and project list.
- `styles.css`: Layout, responsive styles, status badges, and keyboard focus indicators.
- `app.js`: Validation, safe text rendering, stable IDs, confirmed deletion, localStorage persistence, tab updates, and error messages.

## Manual checks

- Open two tabs at the same URL. Add "Tab A test" in tab A, then add "Tab B test" in tab B without refreshing it. Refresh both tabs; both additions and any existing projects should remain. Also check that a draft in one tab stays intact when the other tab adds a project.
- Add two projects with the same name. Click Delete on one and choose Cancel; nothing should change. Repeat and confirm; only that project should disappear, including after refresh. Use Tab and Enter to check the Delete button and confirmation dialog with the keyboard.
- Delete in one tab and check that the other tab updates without losing its draft. Add from the other tab afterward; the deleted project should not return.
- Add projects using each status, with and without a next action; refresh and confirm they remain.
- Try an empty name and a spaces-only name; neither should add a project.
- Enter `<img src=x onerror=alert(1)>` in the name and next action; it should appear literally, including after refresh.
- Use Tab to reach each control, change the status with the keyboard, and press Enter from a text field to add a project.
- Check the page at a narrow mobile width and with a long project name or next action.
- Simulate a save failure in your browser's developer console:

  ```js
  Storage.prototype.setItem = function () {
    throw new DOMException("Simulated storage failure", "QuotaExceededError");
  };
  ```

  Try adding a project or confirming a deletion. An error should appear, the form should keep your entry, and the failed operation should not change saved projects. Refresh to restore normal storage behavior, then confirm adding and deleting work again. This simulation does not delete saved projects.

## Regression checks

With Node.js 18 or newer available, run from the repository folder:

```sh
node --test tests/app.test.cjs
```

No packages are required. These checks run the application with a minimal mock DOM, confirmation dialog, and shared mock storage: ID migration, cancellation, exact-record deletion, stale-tab additions/deletions, storage-event updates, draft preservation, and storage failures. They do not test real browser dialogs, event delivery, or layout. Node.js is only needed for these checks, not to run the app.

## Later
- GitHub and live-demo links.
- Login and cloud storage with Supabase.

## Current progress
The first local version is implemented with plain HTML, CSS, and JavaScript. No frameworks, backend, or login.
