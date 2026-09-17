# Build Log

An app for organizing my software projects and their next actions.

## First version
- Add a project with a required name, a status (Planned, In progress, or Done), and an optional next action.
- View projects in a responsive list.
- Keep projects after refreshing using localStorage in the same browser.
- Reject blank names and display entered content as text.
- Keep the form entry and show a message if saving fails.

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

## Files

- `index.html`: Page structure, labeled project form, and project list.
- `styles.css`: Layout, responsive styles, status badges, and keyboard focus indicators.
- `app.js`: Validation, safe text rendering, localStorage persistence, and error messages.

## Manual checks

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

  Try adding a project. An error should appear, the form should keep your entry, and the list should remain unchanged. Refresh to restore normal storage behavior, then confirm adding works again. This simulation does not delete saved projects.

## Later
- GitHub and live-demo links.
- Login and cloud storage with Supabase.

## Current progress
The first local version is implemented with plain HTML, CSS, and JavaScript. No frameworks, backend, or login.
