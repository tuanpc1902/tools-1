# Reminder Desk

A small Windows command app for date/time and countdown reminders. It opens a local browser interface, while the Node.js process keeps scheduling reminders and sends a native Windows toast when one is due.

Reminders can run once, repeat after a fixed interval, or repeat daily at a selected local time.

## Requirements

- Windows 10 or later
- Node.js 24 or later

No package installation is required; the app uses only Node.js built-in modules.

## Start

Open a command window in this folder and run:

```powershell
npm start
```

Run this command from your own interactive Command Prompt or PowerShell window. A server launched inside a background automation session may not be allowed to send notifications to your Windows desktop.

On first start, the app automatically creates a per-user **Reminder Desk** shortcut in the Start menu so Windows can identify its notifications. This does not require administrator access. If the shortcut is removed, the app recreates it the next time it starts.

The UI opens at `http://127.0.0.1:4317`. Keep the command window open while reminders are active. The browser tab may be closed; alerts still work because scheduling happens in the command process.

Press **Ctrl+C** in the command window to stop the app. Reminders do not fire while the app is stopped, but saved future reminders remain available after restart. Overdue active reminders fire shortly after restart.

## Repeat options

- **One time**: use a countdown or exact date/time, then move to Completed.
- **Every interval**: alert after the selected duration and continue at that interval until paused or deleted.
- **Daily**: alert at the selected local time every day until paused or deleted.

If the app was stopped through several repeat occurrences, it produces at most one overdue alert and advances directly to the next future occurrence. It does not flood the desktop with missed alerts. Toasts do not need an **OK** confirmation, so every repeat interval is scheduled independently. Depending on Windows notification settings, recent reminders can also remain in Notification Center.

Clicking a toast does not open or change the reminder in this version. If Windows identity registration or toast submission fails, the due reminder and error are printed in the command window instead.

After updating the app while it is already running, stop the old process with **Ctrl+C** and run `npm start` again so it loads the new notification code.

## Data

Reminders are stored locally in `data/reminders.json`. The app does not use accounts, cloud storage, or external network services.

If the JSON file becomes malformed, the app renames it to `data/reminders.corrupt-<timestamp>.json`, reports the backup path in the command window, and starts with an empty reminder list.

## Test

```powershell
npm test
```

The suite covers reminder validation, persistence, recovery, scheduling, API behavior, browser-side time calculations, safe popup invocation, and static server behavior.

## Optional port

Set `PORT` before starting to use a different local port:

```powershell
$env:PORT = 5000
npm start
```
