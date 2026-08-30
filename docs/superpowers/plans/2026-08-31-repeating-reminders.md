# Repeating Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-time, fixed-interval, and daily reminders that advance to their next future trigger without blocking on popup dismissal.

**Architecture:** Extend the reminder domain model with normalized repeat metadata and pure next-trigger calculations. The scheduler persists either a terminal fired state or the next active occurrence before launching a non-blocking Windows alert; the existing API remains the transport for a repeat-aware browser form.

**Tech Stack:** Node.js 24, CommonJS, built-in `node:test`, HTML, CSS, browser JavaScript, Windows PowerShell/WinForms.

**Spec:** `docs/superpowers/specs/2026-08-31-repeating-reminders-design.md`

## Global Constraints

- Existing saved reminders without repeat fields behave as `repeatType: "none"`.
- Repeat types are exactly `none`, `interval`, and `daily`.
- Repeating reminders continue indefinitely until paused or deleted.
- Missed occurrences produce at most one alert and advance directly to the next future trigger.
- Scheduler state is persisted before alert delivery begins.
- Popup dismissal must never block the scheduler.
- Storage remains `data/reminders.json`; no new runtime dependencies are added.
- This workspace is not a Git repository, so commit steps are omitted.

---

### Task 1: Repeat-aware reminder domain

**Files:**
- Modify: `src/reminders.js`
- Modify: `test/reminders.test.js`

**Interfaces:**
- Consumes: create/patch bodies containing `repeatType`, `repeatIntervalSeconds`, or `dailyTime`, plus a numeric local `now` timestamp.
- Produces: `getNextDailyTrigger(dailyTime, now)`, `advanceAfterDue(reminder, now)`, and reminder records with normalized repeat fields.

- [ ] **Step 1: Write failing creation and backward-compatibility tests**

Add tests proving these literal outcomes:

```js
const interval = createReminder(
  { title: 'Stretch', repeatType: 'interval', repeatIntervalSeconds: 90 },
  1_000,
);
assert.equal(interval.mode, 'countdown');
assert.equal(interval.triggerAt, 91_000);
assert.equal(interval.repeatIntervalSeconds, 90);
assert.equal(interval.dailyTime, null);

const legacy = advanceAfterDue(
  { id: 'old', status: 'active', triggerAt: 500 },
  1_000,
);
assert.equal(legacy.status, 'fired');
```

Test that an interval of zero and daily values `24:00`, `09:60`, and malformed strings are rejected. Test that a daily reminder derives `mode: "datetime"` and its first future local trigger from `dailyTime`.

- [ ] **Step 2: Run domain tests and verify RED**

Run: `node --test test/reminders.test.js`

Expected: FAIL because `advanceAfterDue` and repeat normalization do not exist.

- [ ] **Step 3: Implement repeat normalization and local daily calculation**

Create helpers with these contracts:

```js
normalizeRepeat(input, now) => {
  repeatType: 'none' | 'interval' | 'daily',
  repeatIntervalSeconds: number | null,
  dailyTime: string | null,
  mode: 'countdown' | 'datetime',
  triggerAt: number
}

getNextDailyTrigger('09:30', now) => epochMillisecondsStrictlyAfterNow
advanceAfterDue(reminder, now) => firedOrRescheduledReminder
```

For `interval`, calculate the first trigger as `now + repeatIntervalSeconds * 1000`. When advancing an overdue interval, use `steps = floor((now - oldTriggerAt) / intervalMs) + 1` and `next = oldTriggerAt + steps * intervalMs`. For `daily`, construct today's local hour/minute with `new Date(year, month, day, hour, minute)` and add one local calendar day when it is not strictly future. For `none` or a missing repeat type, preserve existing `markFired` behavior.

- [ ] **Step 4: Extend patch behavior**

When repeat fields are supplied, normalize the complete repeat policy, reset status to active, and clear `firedAt`. Preserve repeat fields when a patch changes only title, message, or enabled state. Changing to `none` requires the existing one-time `mode` plus `triggerAt` or `durationSeconds` fields.

- [ ] **Step 5: Run domain and full tests**

Run: `npm test`

Expected: all existing tests plus new recurrence tests PASS.

---

### Task 2: Scheduler advancement without catch-up floods

**Files:**
- Modify: `src/scheduler.js`
- Modify: `test/scheduler.test.js`
- Modify: `test/server.test.js`

**Interfaces:**
- Consumes: `advanceAfterDue(reminder, now)` from Task 1 and the existing store/delivery dependencies.
- Produces: persisted next occurrences for repeating reminders while retaining one-time completion.

- [ ] **Step 1: Write failing interval and daily scheduler tests**

Use a mixed reminder array with one one-time, one interval, and one daily reminder. Assert one `replaceAll` occurs before any delivery; the one-time reminder is fired; repeat reminders remain active with future `triggerAt` values; and each due reminder is delivered exactly once.

```js
await scheduler.checkNow();
assert.equal(reminders.find(item => item.id === 'once').status, 'fired');
assert.equal(reminders.find(item => item.id === 'loop').status, 'active');
assert.ok(reminders.find(item => item.id === 'loop').triggerAt > now);
assert.deepEqual(delivered.sort(), ['daily', 'loop', 'once']);
```

Add a restart-style test where an interval is overdue by five cycles and verify only one delivery occurs and the stored next trigger skips directly past `now`.

- [ ] **Step 2: Run scheduler tests and verify RED**

Run: `node --test test/scheduler.test.js`

Expected: FAIL because the scheduler currently marks every due reminder fired.

- [ ] **Step 3: Replace unconditional firing with recurrence advancement**

Map each due reminder through `advanceAfterDue(reminder, checkedAt)`, persist the full array once, then deliver the original due reminder content. Keep the overlap guard and per-delivery error handling. A delivery error must not revert either fired or advanced state.

- [ ] **Step 4: Extend the live server integration test**

Create an interval reminder through `POST /api/reminders`, advance the fake clock beyond multiple occurrences, call `scheduler.checkNow()`, and assert the API returns the same reminder ID with `status: "active"` and a future `triggerAt`. Assert one delivery call.

- [ ] **Step 5: Run scheduler, server, and full tests**

Run: `npm test`

Expected: every test PASS with no skipped tests.

---

### Task 3: Repeat-aware API and browser UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/app.js`
- Modify: `test/ui.test.js`
- Modify: `test/api.test.js`

**Interfaces:**
- Consumes: repeat-aware JSON API records from Tasks 1 and 2.
- Produces: `getRepeatPayload(values, now)`, `getRepeatLabel(reminder)`, repeat form controls, and repeat labels on active cards.

- [ ] **Step 1: Write failing browser-logic tests**

Export and test `getRepeatPayload` and `getRepeatLabel`:

```js
assert.deepEqual(
  getRepeatPayload({ repeatType: 'interval', hours: '0', minutes: '5', seconds: '0' }),
  { repeatType: 'interval', repeatIntervalSeconds: 300 },
);
assert.deepEqual(
  getRepeatPayload({ repeatType: 'daily', dailyTime: '08:15' }),
  { repeatType: 'daily', dailyTime: '08:15' },
);
assert.equal(getRepeatLabel({ repeatType: 'interval', repeatIntervalSeconds: 300 }), 'Every 5 minutes');
assert.equal(getRepeatLabel({ repeatType: 'daily', dailyTime: '08:15' }), 'Daily at 08:15');
```

Test that missing repeat metadata returns `One time` and that invalid daily input throws a clear error.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `node --test test/ui.test.js`

Expected: FAIL because the repeat helpers do not exist.

- [ ] **Step 3: Add repeat controls and client behavior**

Add a labeled Repeat selector with `one time`, `every interval`, and `daily` options. Keep the existing trigger-mode switch visible only for one-time reminders. Show the duration fields for interval repeats and a new `<input type="time">` for daily repeats. Build create/patch bodies with `getRepeatPayload`; populate repeat fields during edit; reset to one-time after submission.

- [ ] **Step 4: Render repeat status on cards**

Place the result of `getRepeatLabel(reminder)` in each card kicker. Repeating cards remain in Active because their scheduler status stays active. Preserve keyboard focus behavior, responsive layout, reduced-motion behavior, and existing visual system.

- [ ] **Step 5: Extend API behavior tests**

Create interval and daily reminders via the real handler. Assert interval records contain `mode: "countdown"`, `repeatIntervalSeconds`, and a derived trigger; assert daily records contain `mode: "datetime"`, normalized `dailyTime`, and `repeatIntervalSeconds: null`. Patch an interval reminder to daily and assert irrelevant fields become null.

- [ ] **Step 6: Run all automated tests**

Run: `npm test`

Expected: all domain, scheduler, API, server, popup, storage, and UI tests PASS.

---

### Task 4: Non-blocking, topmost Windows popup and documentation

**Files:**
- Modify: `src/popup.js`
- Modify: `test/popup.test.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: the existing `showWindowsPopup(reminder, { spawn })` call.
- Produces: a promise that resolves when PowerShell successfully starts, not when the dialog closes.

- [ ] **Step 1: Replace exit-based popup tests with launch-based tests**

Use a fake child process that emits `spawn` and never emits `exit`. Assert `showWindowsPopup` resolves, calls `child.unref()`, keeps `shell: false`, and passes reminder text only through environment variables. Keep the error-before-spawn rejection test.

```js
const child = new EventEmitter();
child.unref = () => { unrefCalled = true; };
queueMicrotask(() => child.emit('spawn'));
await showWindowsPopup(reminder, { spawn: () => child });
assert.equal(unrefCalled, true);
```

- [ ] **Step 2: Run popup tests and verify RED**

Run: `node --test test/popup.test.js`

Expected: FAIL because the current promise waits for process exit.

- [ ] **Step 3: Implement non-blocking topmost launch**

Resolve on the child's `spawn` event, call `unref()`, and reject only an error emitted before successful spawn. Update the fixed PowerShell script to create a tiny hidden `System.Windows.Forms.Form` with `TopMost = $true`, use it as the message-box owner, then dispose it after dismissal. Continue reading title/message from environment variables and never interpolate user text into PowerShell source.

- [ ] **Step 4: Update usage documentation**

Document the three repeat policies, missed-occurrence skipping, pause/delete behavior, and the requirement to launch `npm start` from the user's own interactive Command Prompt so Windows can display dialogs on that desktop.

- [ ] **Step 5: Perform final verification**

Run: `npm test`

Expected: all tests PASS with zero failures.

Then run `npm start` from an interactive Windows terminal, create a 2-second interval reminder, and confirm it remains Active and advances after at least two alerts. Leave the first dialog open long enough for the next interval to become due and verify scheduling continues. Create a daily reminder and confirm the card displays the correct next local time.
