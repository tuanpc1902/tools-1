# Repeating Reminders Design

## Objective

Extend Reminder Desk so a reminder may fire once, repeat after a fixed interval, or repeat daily at a selected local time. Repeating reminders remain active indefinitely until paused or deleted.

## Repeat policies

Every reminder stores one repeat policy:

- `none`: fire once, then move to Completed.
- `interval`: repeat after a positive interval measured in seconds.
- `daily`: repeat once per day at a selected local hour and minute.

There is no maximum repeat count. Pausing a reminder preserves its repeat policy. Editing a reminder may change its repeat policy and recalculates its next trigger.

## Scheduling behavior

When a one-time reminder becomes due, the scheduler persists it as fired before launching the alert.

When a repeating reminder becomes due, the scheduler calculates and persists its next future trigger before launching the alert. Interval recurrence advances from the previously scheduled trigger in whole interval steps until the result is in the future. Daily recurrence finds the next occurrence of the chosen local hour and minute using the machine's local calendar.

If the application was stopped through one or more occurrences, missed occurrences are skipped. Restarting produces at most one immediate alert for an overdue reminder, then schedules its next future occurrence. It never produces a burst of catch-up alerts.

The scheduler does not wait for the user to dismiss a Windows alert. A visible dialog cannot block other reminders or future repetitions. Alert-launch failures are reported prominently in the terminal without reverting the persisted reminder state.

## Data model

Existing reminder records gain:

- `repeatType`: `none`, `interval`, or `daily`
- `repeatIntervalSeconds`: a positive number for interval repeats, otherwise `null`
- `dailyTime`: a local `HH:MM` string for daily repeats, otherwise `null`

Existing saved reminders that lack these fields are treated as one-time reminders. Storage remains in `data/reminders.json`.

## User interface

The reminder form gains a Repeat selector:

- **One time** uses the existing date/time or countdown trigger controls.
- **Every interval** uses the hours, minutes, and seconds controls as the repeat interval. The first alert occurs after that interval.
- **Daily** uses a local time input. The first alert occurs at the next matching local time.

Active reminder cards show a human-readable repeat rule and the next alert time. Repeating reminders remain in Active after each alert. Only completed one-time reminders appear in Completed. Edit, pause, enable, and delete controls continue to work for every policy.

## Validation and API

Browser and server validation require a positive interval for interval repeats and a valid `HH:MM` local time for daily repeats. API create and patch operations accept the repeat fields, normalize irrelevant repeat fields to `null`, and preserve backward compatibility with existing one-time request bodies and saved records.

For storage consistency, interval repeats use the existing `countdown` mode and daily repeats use the existing `datetime` mode. The server derives those modes from the selected repeat policy instead of requiring the browser to supply conflicting combinations.

## Verification

Automated tests cover:

- One-time completion behavior
- Interval trigger advancement and skipped missed occurrences
- Daily local-time calculation, including day rollover
- Backward compatibility for existing saved reminders
- Pause, resume, edit, and API persistence behavior
- UI repeat-input conversion, grouping, and labels
- Non-blocking popup launch and delivery-error reporting

Manual verification creates one short interval reminder and confirms it alerts more than once while remaining active. It also creates a daily reminder, confirms its displayed next time, and verifies that dismissing or leaving one popup open does not block another reminder.

## Success criteria

A user can choose one-time, interval, or daily behavior in the local UI. Interval and daily reminders remain active, advance to the correct next future trigger, survive restarts, skip missed occurrences without flooding alerts, and continue scheduling without waiting for popup dismissal.
