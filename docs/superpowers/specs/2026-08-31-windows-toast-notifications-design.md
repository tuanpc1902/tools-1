# Windows Toast Notifications Design

## Objective

Replace modal WinForms message boxes with native Windows toast notifications so interval and daily reminders can alert independently without waiting for an OK button.

## Windows application identity

Reminder Desk is an unpackaged desktop application. On startup, it checks for a per-user Start-menu shortcut carrying the stable Application User Model ID `ReminderDesk.Local`. Windows requires this identity for reliable desktop toast delivery.

If the shortcut is absent, the app registers it automatically without administrator privileges. The shortcut launches the current Node.js executable with the absolute `src/index.js` path and uses the project root as its working directory. Registration is idempotent and does not rewrite an existing shortcut on every launch.

The shortcut is stored only in the current user's Start menu. Removing it disables toast identity registration but does not delete saved reminders. The next app launch recreates it.

## Toast delivery

The alert module submits a `ToastGeneric` notification through the built-in Windows Runtime notification APIs using the `ReminderDesk.Local` identity. Each toast contains the reminder title and optional message.

Toast submission runs in a short-lived hidden PowerShell process. It resolves when the submission process launches and does not wait for the toast to be dismissed. The Windows notification system owns the toast after submission, allowing multiple repeat occurrences to appear independently and accumulate in Notification Center.

Clicking a toast has no application action in this version. No buttons, remote images, sound customization, or activation callback are included.

## Safety and failure behavior

Reminder title and message are XML-escaped before delivery and passed through environment variables. User text is never interpolated into PowerShell source or command arguments.

If identity registration fails, app startup continues and prints a clear warning. If toast submission cannot launch or fails synchronously, the reminder remains in its already-persisted fired or advanced state and the terminal prints a prominent fallback alert. The app never falls back to modal message boxes because those can block or visually stack.

## Components

- `src/notification-identity.js` locates and ensures the per-user Start-menu shortcut.
- `scripts/register-notification-identity.ps1` creates the shortcut and sets its AUMID through Windows Shell COM APIs.
- `src/popup.js` keeps its existing public `showWindowsPopup` function name for internal compatibility but changes its implementation to submit a toast.
- `src/index.js` ensures notification identity during startup before scheduling begins.

## Verification

Automated tests cover:

- First-run registration when the shortcut is missing
- Skipping registration when the shortcut already exists
- Correct stable AUMID and absolute launch paths
- XML escaping for titles and messages
- User text remaining outside executable PowerShell source and arguments
- Delivery resolving without waiting for user interaction
- Registration and delivery error reporting

Manual verification runs from the user's interactive Windows terminal. It confirms the Start-menu shortcut exists, a native toast appears, and a five-second interval produces a second toast while the first remains unselected. It also confirms both notifications appear in Notification Center and the reminder remains Active with an advancing next trigger.

## Success criteria

Reminder Desk automatically establishes its per-user Windows notification identity and displays non-modal native toasts. Repeating reminders continue producing visible notifications without requiring the user to click OK, and no modal dialog process is created.
