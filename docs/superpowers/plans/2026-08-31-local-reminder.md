# Local Reminder App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows command app that hosts a local reminder UI and produces exactly one native popup for date/time or countdown reminders.

**Architecture:** A dependency-free Node.js HTTP process owns reminder validation, JSON persistence, scheduling, and Windows popup delivery. A static browser client talks to a localhost JSON API; countdowns are normalized into absolute timestamps so reminders survive restarts.

**Tech Stack:** Node.js 24, CommonJS, built-in `node:http`, `node:test`, HTML, CSS, browser JavaScript, Windows PowerShell for native message boxes.

**Spec:** `docs/superpowers/specs/2026-08-31-local-reminder-design.md`

## Global Constraints

- Target Windows only for version 1.
- Bind the HTTP server only to `127.0.0.1`.
- Avoid a heavyweight desktop framework and external runtime dependencies.
- Store reminders in `data/reminders.json` and preserve malformed data as a backup.
- Mark and persist due reminders as fired before attempting popup delivery.
- Alerts continue while the browser is closed, but stop when the Node.js process exits.
- The UI must be responsive and keyboard accessible.

---

### Task 1: Reminder domain model and project test harness

**Files:**
- Create: `package.json`
- Create: `src/reminders.js`
- Create: `test/reminders.test.js`
- Create: `.gitignore`

**Interfaces:**
- Consumes: Plain JSON request bodies and an optional numeric `now` timestamp.
- Produces: `createReminder(input, now)`, `applyReminderPatch(existing, patch, now)`, `getDueReminders(reminders, now)`, and `markFired(reminder, now)`.

- [ ] **Step 1: Add the Node test harness and failing domain tests**

Create `package.json` with `start` set to `node src/index.js` and `test` set to `node --test`. Add tests proving that date/time reminders reject past times, countdowns reject a zero duration, countdowns become absolute trigger timestamps, patches preserve IDs, and only active due reminders are returned.

```js
const reminder = createReminder(
  { title: 'Stretch', message: 'Stand up', mode: 'countdown', durationSeconds: 90 },
  1_000,
);
assert.equal(reminder.triggerAt, 91_000);
assert.equal(reminder.status, 'active');
assert.throws(() => createReminder({ title: 'Late', mode: 'datetime', triggerAt: 999 }, 1_000));
```

- [ ] **Step 2: Run the tests and verify the expected module-not-found failure**

Run: `npm test`

Expected: FAIL because `src/reminders.js` does not exist.

- [ ] **Step 3: Implement the reminder domain functions**

Use `crypto.randomUUID()` for IDs. Normalize strings with `trim()`, require a title, accept an optional message, require either `mode: "datetime"` with a future numeric `triggerAt` or `mode: "countdown"` with a positive finite `durationSeconds`, and store this shape:

```js
{
  id: string,
  title: string,
  message: string,
  mode: 'datetime' | 'countdown',
  triggerAt: number,
  status: 'active' | 'disabled' | 'fired',
  createdAt: number,
  firedAt: number | null
}
```

`getDueReminders` returns reminders whose status is `active` and `triggerAt <= now`. `markFired` returns a copy with `status: "fired"` and `firedAt: now`. `applyReminderPatch` may change title, message, trigger inputs, or enabled state but never ID or creation time; rescheduling returns the reminder to active status.

- [ ] **Step 4: Run domain tests**

Run: `npm test`

Expected: all reminder-domain tests PASS.

- [ ] **Step 5: Add ignore rules**

Create `.gitignore` containing `data/reminders.json`, `data/reminders.json.tmp`, `data/reminders.corrupt-*.json`, and `node_modules/`.

---

### Task 2: Durable JSON storage and scheduler

**Files:**
- Create: `src/storage.js`
- Create: `src/scheduler.js`
- Create: `test/storage.test.js`
- Create: `test/scheduler.test.js`

**Interfaces:**
- Consumes: `createStore(filePath, { onWarning })`, reminder arrays, `deliver(reminder)`, and optional clock/timer dependencies.
- Produces: store methods `load()`, `list()`, `replaceAll(reminders)`, `upsert(reminder)`, and `remove(id)`; scheduler methods `checkNow()` and `stop()`.

- [ ] **Step 1: Write failing storage tests**

Use a test-only temporary directory. Prove that a missing file loads as an empty array, `upsert` survives a fresh store instance, `remove` persists, and malformed JSON is renamed to `reminders.corrupt-<timestamp>.json` while `onWarning` is called.

```js
const first = createStore(filePath, { onWarning: warnings.push.bind(warnings) });
await first.upsert(reminder);
const second = createStore(filePath, { onWarning: warnings.push.bind(warnings) });
assert.deepEqual(await second.load(), [reminder]);
```

- [ ] **Step 2: Verify storage tests fail**

Run: `node --test test/storage.test.js`

Expected: FAIL because `src/storage.js` does not exist.

- [ ] **Step 3: Implement atomic storage**

Create the parent directory on first write. Serialize with two-space indentation to `<file>.tmp`, then rename it over the target. Keep an in-memory array after `load()`. On malformed JSON, rename the source to `reminders.corrupt-${Date.now()}.json`, warn with the backup path, and continue with an empty array.

- [ ] **Step 4: Write failing scheduler tests**

Use fake `now`, a stub store, and a delivery spy. Prove `checkNow()` marks and persists a due reminder before calling `deliver`, ignores future/disabled/fired reminders, and does not deliver the same reminder twice.

```js
const events = [];
const store = {
  list: () => reminders,
  replaceAll: async next => { events.push('persist'); reminders = next; },
};
const scheduler = createScheduler({ store, deliver: async () => events.push('deliver'), now: () => 5_000 });
await scheduler.checkNow();
assert.deepEqual(events, ['persist', 'deliver']);
```

- [ ] **Step 5: Implement and verify the scheduler**

Implement `createScheduler({ store, deliver, now = Date.now, intervalMs = 1000 })`. Prevent overlapping checks, use an unref'd interval, persist all due reminders as fired before sequential delivery, log delivery errors without restoring fired state, and expose `stop()`.

Run: `npm test`

Expected: all domain, storage, and scheduler tests PASS.

---

### Task 3: Local JSON API

**Files:**
- Create: `src/api.js`
- Create: `test/api.test.js`

**Interfaces:**
- Consumes: `createApiHandler({ store, now })`, JSON HTTP requests, and the domain functions from Task 1.
- Produces: an async Node request handler supporting `GET/POST /api/reminders`, `PATCH/DELETE /api/reminders/:id`, and structured `{ error }` responses.

- [ ] **Step 1: Write failing API integration tests**

Start a temporary `node:http` server around the handler. Test list, create countdown, reject invalid input with 400, edit, disable, delete, unknown ID with 404, unknown route with 404, and malformed JSON with 400.

```js
const response = await fetch(`${baseUrl}/api/reminders`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ title: 'Tea', mode: 'countdown', durationSeconds: 60 }),
});
assert.equal(response.status, 201);
assert.equal((await response.json()).triggerAt, now + 60_000);
```

- [ ] **Step 2: Verify API tests fail**

Run: `node --test test/api.test.js`

Expected: FAIL because `src/api.js` does not exist.

- [ ] **Step 3: Implement the API handler**

Limit request bodies to 64 KiB, require JSON objects, return `content-type: application/json; charset=utf-8`, and map domain validation errors to status 400. Return created reminders with 201, updates with 200, successful deletes with 204, and missing routes/reminders with 404.

- [ ] **Step 4: Verify the API**

Run: `npm test`

Expected: every API and lower-level test PASS.

---

### Task 4: Responsive reminder control desk UI

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`
- Create: `test/static.test.js`

**Interfaces:**
- Consumes: the Task 3 JSON API.
- Produces: an accessible form and reminder-card interface with `loadReminders()`, `submitReminder(event)`, `renderReminders(reminders)`, and `request(path, options)`.

- [ ] **Step 1: Write failing static-contract tests**

Read the three static files and assert that the HTML includes labeled title, message, mode, date/time, hours, minutes, and seconds controls; a live validation region; active and completed list regions; and script/style references. Assert the client contains API create, patch, and delete calls.

- [ ] **Step 2: Verify the static tests fail**

Run: `node --test test/static.test.js`

Expected: FAIL because the public files do not exist.

- [ ] **Step 3: Implement semantic HTML and client behavior**

Build one form that switches between date/time and countdown fieldsets without removing labels from the accessibility tree. Convert `datetime-local` to epoch milliseconds. Convert hours/minutes/seconds to total seconds. Render active cards first, completed cards separately, update visible time remaining every second, and support edit, enable/disable, and delete actions. Display server messages in an `aria-live="polite"` region and focus the first invalid input.

- [ ] **Step 4: Apply the visual system**

Use CSS custom properties for cream paper, near-black ink, muted olive, and signal red. Pair Georgia-like editorial display text with a compact monospace body face available on Windows. Add subtle paper grain with layered CSS gradients, strong offset borders/shadows, restrained staggered entry animation, visible focus rings, reduced-motion handling, and a single-column mobile breakpoint below 720px.

- [ ] **Step 5: Verify UI contracts and all automated tests**

Run: `npm test`

Expected: every test PASS.

---

### Task 5: Windows popup, server entry point, and end-to-end verification

**Files:**
- Create: `src/popup.js`
- Create: `src/index.js`
- Create: `test/popup.test.js`
- Create: `test/server.test.js`
- Create: `README.md`

**Interfaces:**
- Consumes: `showWindowsPopup(reminder, { spawn })`, Task 2 store/scheduler, Task 3 API handler, and `public/` assets.
- Produces: the `npm start` command, localhost server, automatic browser launch, native Windows popup delivery, and operator documentation.

- [ ] **Step 1: Write failing popup tests**

Inject a fake `spawn` and assert that `showWindowsPopup` launches `powershell.exe` without a shell, passes title/message through environment variables rather than interpolating them into script source, and rejects when the child emits an error or exits non-zero.

```js
await showWindowsPopup(
  { title: "Don't interpolate", message: 'Safe text' },
  { spawn: fakeSpawn },
);
assert.equal(call.options.shell, false);
assert.equal(call.options.env.REMINDER_TITLE, "Don't interpolate");
```

- [ ] **Step 2: Implement native popup delivery**

Spawn hidden `powershell.exe` with `-NoProfile`, `-NonInteractive`, and a fixed command that loads `System.Windows.Forms` and reads `REMINDER_TITLE` and `REMINDER_MESSAGE` from the child environment. Use `MessageBox.Show` with an information icon and OK button. Do not use `exec` or construct PowerShell source from reminder text.

- [ ] **Step 3: Write failing server tests**

Export `createAppServer({ dataFile, publicDir, deliver, now })`. Verify it binds to an explicitly supplied host/port, serves `/` and static CSS/JS with correct content types, blocks path traversal, returns 404 for missing assets, and shares the same store between the API and scheduler.

- [ ] **Step 4: Implement the server entry point**

Compose storage, API, scheduler, and safe static file handling. In direct-run mode, bind `127.0.0.1` on `process.env.PORT || 4317`, print the URL, and open it using `cmd.exe /c start "" <url>` with arguments passed without shell interpolation. Log a prominent boxed fallback containing reminder title/message if popup delivery rejects. Stop the scheduler and close the server on Ctrl+C.

- [ ] **Step 5: Document operation and limitations**

Write `README.md` with prerequisites (Windows and Node.js 24+), `npm start`, `npm test`, where data is stored, browser-close behavior, terminal-close limitation, corrupt-data recovery behavior, and how to stop the app.

- [ ] **Step 6: Run automated verification**

Run: `npm test`

Expected: all tests PASS with no skipped tests.

- [ ] **Step 7: Run manual end-to-end verification**

Run: `npm start`

Create a 10-second countdown, close the browser tab, and verify one native Windows popup appears. Restart the app, create a future date/time reminder, restart again before it fires, and verify it fires once at the expected local time. Confirm invalid and past inputs show clear inline errors and the UI remains usable at a 375-pixel viewport.

