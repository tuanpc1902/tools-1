# Confirmed recurring reminders design

## Goal

Recurring reminders pause after their alert and begin the next interval only after the user confirms in either the Windows toast or the web UI.

## Behavior

- One-time reminders keep the current behavior: delivery records them as fired.
- When an interval or daily reminder becomes due, the scheduler persists `awaiting_confirmation` before delivery.
- An awaiting reminder has no active countdown and does not produce duplicate alerts while it waits.
- Confirming from either surface records `confirmedAt`, returns the reminder to `active`, and derives the next trigger from that confirmation:
  - interval: `confirmedAt + repeatIntervalSeconds * 1000`;
  - daily: the next local occurrence of `dailyTime` after `confirmedAt`.
- If the app restarts while a reminder awaits confirmation, it remains awaiting until explicitly confirmed.

## Windows toast confirmation

ToastGeneric notifications include a `Confirm` button with a `reminderdesk://confirm/<id>` protocol argument. A per-user `HKCU\\Software\\Classes\\reminderdesk` registration launches a short-lived Node helper with the URI. The helper validates the reminder id and sends `POST /api/reminders/<id>/confirm` to the local server, using the configured `PORT` query parameter or 4317.

Protocol registration is created without administrator rights alongside the existing per-user Start-menu notification identity. Missing registration is recreated on startup. Toast delivery remains a best-effort operation with terminal fallback if Windows rejects it.

## Web confirmation

Awaiting cards show `Confirm` and `Delete` actions. The Confirm action calls the local API and reloads the list. Active, disabled, and completed actions retain their current semantics.

## API and state

- Add `POST /api/reminders/:id/confirm`.
- Return 404 for an unknown id and 409 when the reminder is not awaiting confirmation.
- Add `awaiting_confirmation`, `alertedAt`, and `confirmedAt` fields to the durable reminder model; preserve older JSON files without these fields.
- Scheduler delivery must persist the waiting state before invoking the toast, and confirmation must persist the next active trigger before responding.

## Testing

- Reminder model tests cover waiting and confirmation transitions for interval and daily policies, including restart-safe persistence.
- Scheduler tests prove a due recurring reminder delivers once, waits, and does not advance until confirmation.
- API tests cover the confirm endpoint success, 404, and 409 responses.
- Popup tests assert escaped ToastGeneric action XML and the reminder id remains in environment data rather than PowerShell source.
- Identity tests cover protocol registration arguments and idempotent startup.
- UI tests cover the awaiting label and confirm action payload helper.

## Constraints

- No external dependencies or administrator access.
- Existing reminder creation, editing, disabling, deleting, and all three visual skins remain compatible.
- Local protocol activation is only a transport into the already-running local server; it is not an internet callback.
