# Local Reminder App Design

## Objective

Build a small Windows command-line application that starts a local browser UI and alerts the user with a native popup. It supports reminders triggered by either a specific local date and time or a countdown duration.

## Runtime model

- The user starts the app with `npm start`.
- A lightweight Node.js process starts an HTTP server on localhost and opens the UI in the default browser.
- The Node.js process remains open and owns scheduling, persistence, and popup delivery. Reminders continue after the browser tab closes, but stop while the Node.js process is not running.
- The app uses Node.js built-in modules where practical and avoids a heavyweight desktop framework.

## User interface

The UI is a compact reminder control desk with a warm utilitarian aesthetic: cream paper tones, dark ink typography, and a vivid red alert accent. It is responsive and keyboard accessible.

The primary form contains:

- Reminder title and optional message
- Trigger mode switch: **Date & time** or **Countdown**
- A local date/time input for scheduled reminders
- Duration fields for countdown reminders
- A create-reminder action with inline validation feedback

Active and completed reminders appear as cards. Active cards show the trigger time and live time remaining. Each reminder can be enabled or disabled, edited, or deleted. Completed one-time reminders remain visible until deleted and never fire repeatedly.

## Data model and persistence

Each reminder contains a generated ID, title, message, trigger mode, absolute trigger timestamp, status, creation timestamp, and fired timestamp when applicable. Countdown input is converted to an absolute trigger timestamp on creation so restarts do not reset the countdown.

The server stores reminders in `data/reminders.json`. Writes use a temporary file followed by replacement to reduce the chance of partial data. Missing storage is initialized automatically. Malformed storage is preserved as a backup, and the app starts with an empty set while reporting the problem in the terminal.

## Scheduling and alerts

The server periodically checks enabled reminders against the current system time. When a reminder becomes due, it marks and persists the reminder as fired before displaying the popup, preventing duplicate alerts if popup delivery fails.

On Windows, the app launches a small native message box containing the title and message with an **OK** button. If native popup delivery fails, the terminal displays a prominent fallback alert and logs the error. The first version targets Windows only.

## Local API

The localhost server exposes a small JSON API to list, create, update, enable or disable, and delete reminders. Both the UI and server validate input. The server rejects empty titles, invalid timestamps, past date/time reminders, and non-positive countdowns with clear messages.

The server binds only to `127.0.0.1`. No accounts, cloud services, or external network access are required.

## Verification

Automated tests cover:

- Date/time and countdown validation
- Countdown conversion to an absolute timestamp
- Persistence and reload behavior
- State transitions from active to fired
- One-time delivery semantics
- API validation and CRUD behavior

Manual verification confirms that the UI is responsive and keyboard usable, the browser can close without stopping alerts, reminders survive an app restart, and a short countdown produces a native Windows popup.

## Success criteria

Running `npm start` opens the local UI. A user can create either trigger type, manage saved reminders, close the browser, and receive exactly one native popup at the correct time while the terminal process remains running.
