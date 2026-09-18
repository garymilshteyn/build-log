# Build Log

An app for organizing my software projects and their next actions.

Built with plain HTML, CSS, and JavaScript. No frameworks, backend, or login.

## Live demo

[Try Build Log](https://build-log-iota.vercel.app)

No account required. Projects are saved only in the browser you use; they do not sync across browsers or devices.

## Features

- Add a project with a required name, a status (Planned, In progress, or Done), and an optional next action.
- View projects in a responsive list.
- Keep projects after refreshing using localStorage in the same browser.
- Reject blank names and display entered content as text.
- Keep the form entry and show a message if saving fails.
- Delete an individual project after confirmation, including when projects have identical names.
- Edit a project's name, status, and next action, with Save changes and Cancel.
- Export saved projects as a readable JSON backup.

## Run locally

Prerequisite: Python 3. No packages or build step are needed.

1. Open a terminal in the `build-log` repository folder.
2. Run:

   ```sh
   python3 -m http.server 8000 --bind 127.0.0.1
   ```

3. Open **http://127.0.0.1:8000** in your browser.
4. To stop the server, press **Ctrl+C** in the terminal.

The local server only serves static files; there is no application backend.

## Data storage and limitations

Use the same browser and URL (including port) to return to your saved projects. Projects stay on this browser only; clearing its site data removes them. Opening `index.html` directly is not recommended because localStorage behavior for file URLs varies by browser.

Each addition, saved edit, or confirmed deletion rereads the latest stored projects, and other open tabs update their lists when storage changes without clearing their forms. This preserves unrelated sequential changes from stale tabs. Truly simultaneous writes (including initial ID migration) can still conflict because the localStorage read and write are not one atomic operation. If two tabs edit the same project, the last successful save replaces its editable fields; there is no conflict resolution.

Projects have stable IDs so deletion targets a single record, not a name or list position. Existing records without IDs receive them automatically, preserving their fields and order. IDs are saved before those projects are displayed; if this migration cannot be saved, an error appears and the original stored data remains untouched. Invalid or duplicate IDs are rejected rather than risking deletion of the wrong record. ID generation uses the browser's `crypto.randomUUID()`; use a modern browser at the local URL above (or HTTPS).

## Editing a project

The shared form starts with the heading and button labeled **Add project**. Clicking a project's Edit button fills that same form, changes its heading to **Edit project**, shows **Save changes** and **Cancel**, and focuses the project-name field. Change the name, status, or optional next action, then choose Save changes (or press Enter from a text field).

Saving successfully or choosing Cancel returns to Add mode and restores all three fields of any unfinished Add draft, including whitespace. Cancel does not change saved data. One project can be edited at a time; save or cancel before starting another edit.

Edits target the existing stable ID, so identical names are safe. Blank or whitespace-only names are rejected. If saving fails, the form stays in Edit mode with an error and your draft intact. If another tab deleted the project, Save changes reports that it is unavailable and does not recreate it; copy anything you need before choosing Cancel. Drafts are not saved across page refreshes.

## Exporting projects

Click **Export projects** beside Your projects to download `build-log-projects-YYYY-MM-DD.json`, using your device’s local date. The file contains the latest saved list, formatted with two-space indentation, including each project’s ID, name, status, and next action. Additional stored fields are preserved too. An empty list exports as `[]`.

Export does not save or clear unfinished Add/Edit drafts, switch form modes, or change stored projects. If storage is blocked or invalid, an error appears and no backup downloads. Export will also refuse older records that still lack IDs; let the app complete its normal ID migration before exporting. If migration failed, fix the storage problem and reload after copying any drafts you need to keep.

**Importing backups is not implemented yet.** Keep the JSON file as a copy of your saved data; it cannot currently be restored through the app. The download is a snapshot, so later changes in another tab are not included.

## Automated tests

The [Automated tests workflow](.github/workflows/tests.yml) runs the existing regression tests on pull requests targeting `main` and pushes to `main`. It uses Node.js 24 LTS on Ubuntu with read-only repository permissions and reports any test failures in GitHub Actions.

To run the same check locally, use a supported Node.js LTS version (Node.js 24 to match CI) and run from the repository folder:

```sh
node --test tests/app.test.cjs
```

No packages are required. These checks run the application with a minimal mock DOM, confirmation dialog, download APIs, and shared mock storage: ID migration, cancellation, editing and deletion by ID, edit validation, stale-tab additions/edits/deletions, storage-event updates, draft preservation, storage failures, JSON export, and temporary download cleanup. They do not test real browser dialogs, downloads, event delivery, or layout. Node.js is only needed for these checks, not to run the app.

## Manual checks

These are checks to perform in a browser, not a record of completed verification.

- Click Export projects and inspect the downloaded filename and JSON. Check the local date, all saved fields, and an empty-list export. Repeat while an Add or Edit draft is unfinished; its fields and mode should stay intact. Check keyboard activation and that your browser starts the download successfully.
- Open two tabs at the same URL. Add "Tab A test" in tab A, then add "Tab B test" in tab B without refreshing it. Refresh both tabs; both additions and any existing projects should remain. Also check that a draft in one tab stays intact when the other tab adds a project.
- Add two projects with the same name. Click Delete on one and choose Cancel; nothing should change. Repeat and confirm; only that project should disappear, including after refresh. Use Tab and Enter to check the Delete button and confirmation dialog with the keyboard.
- Delete in one tab and check that the other tab updates without losing its draft. Add from the other tab afterward; the deleted project should not return.
- Edit one of two identically named projects, change all three fields, save, and refresh; only the selected project should change. Repeat with Cancel and with a spaces-only name; neither should change saved data.
- Start editing in one tab, then add or edit a different project in another tab. Save the first edit; both changes should remain. Repeat after deleting the edited project in the other tab; Save should show an error and keep your draft without recreating the project.
- Start an Add draft with all three fields filled. Use Edit, Save changes, and Cancel with the keyboard; verify the heading and buttons switch modes, focus moves to the name field, and the exact Add draft returns after saving or canceling. Check that storage updates from another tab leave both drafts intact.
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

  Try adding a project, saving an edit, or confirming a deletion. An error should appear, the form should keep your entry, and the failed operation should not change saved projects. Refresh to restore normal storage behavior, then confirm adding, editing, and deleting work again. Copy any draft you want to keep before refreshing. This simulation does not delete saved projects.

## Files

- `index.html`: Page structure, one labeled form shared by Add and Edit modes, and project list.
- `styles.css`: Layout, responsive styles, status badges, and keyboard focus indicators.
- `app.js`: Validation, safe text rendering, stable IDs, editing, confirmed deletion, localStorage persistence, tab updates, and error messages.
- `tests/app.test.cjs`: Regression tests using Node’s built-in test runner and mocked browser APIs.
- `.github/workflows/tests.yml`: GitHub Actions workflow that runs the tests on pull requests targeting `main` and pushes to `main`.

## Planned improvements

- Login and cloud storage with Supabase.
