# Confirmed recurring reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pause interval and daily reminders after delivery and start their next countdown only after Confirm from Windows or the web UI.

**Architecture:** Recurring due reminders transition to durable `awaiting_confirmation` state before delivery. A new confirm API transition computes the next trigger from confirmation time; the web UI calls it directly, while a per-user `reminderdesk://` protocol handler sends the same local request from the Windows toast action.

**Tech Stack:** Node.js 24 built-ins, Windows PowerShell/WinRT ToastGeneric, local HTTP API, browser `localStorage` is not involved.

**Spec:** `docs/superpowers/specs/2026-09-03-confirm-recurring-reminders-design.md`

## Global Constraints

- No external dependencies or administrator access.
- One-time reminders remain terminal when delivered; only recurring reminders await confirmation.
- Awaiting reminders do not advance or deliver duplicate alerts until confirmed.
- Confirm computes interval from `confirmedAt` and daily from the next local occurrence after `confirmedAt`.
- Preserve old reminder JSON files without the new fields and preserve all three visual skins.

---

### Task 1: Model awaiting and confirmation transitions

**Files:**
- Modify: `src/reminders.js`
- Test: `test/reminders.test.js`

**Interfaces:**
- Produce `markAwaitingConfirmation(reminder, now)` returning the reminder with `status: 'awaiting_confirmation'`, `alertedAt: now`, and unchanged schedule.
- Produce `confirmReminder(reminder, now)` throwing `RangeError` unless status is awaiting confirmation, then returning active state with `confirmedAt: now` and the next trigger.
- Extend `advanceAfterDue` so recurring reminders call the awaiting transition while one-time reminders still call `markFired`.

- [ ] **Step 1: Write the failing tests**

Add interval and daily cases to `test/reminders.test.js`:

```js
test('recurring due reminders wait for confirmation without advancing', () => {
  const reminder = createReminder({ title: 'Stretch', repeatType: 'interval', repeatIntervalSeconds: 60 }, 1_000);
  const waiting = advanceAfterDue(reminder, 61_000);
  assert.equal(waiting.status, 'awaiting_confirmation');
  assert.equal(waiting.triggerAt, reminder.triggerAt);
  assert.equal(waiting.alertedAt, 61_000);
});

test('confirmation starts the next interval from the confirmation time', () => {
  const reminder = createReminder({ title: 'Stretch', repeatType: 'interval', repeatIntervalSeconds: 60 }, 1_000);
  const waiting = advanceAfterDue(reminder, 61_000);
  const active = confirmReminder(waiting, 90_000);
  assert.equal(active.status, 'active');
  assert.equal(active.triggerAt, 150_000);
  assert.equal(active.confirmedAt, 90_000);
});

test('daily confirmation schedules the next local occurrence', () => {
  const reminder = createReminder({ title: 'Review', repeatType: 'daily', dailyTime: '08:15' }, new Date('2030-05-10T07:00:00').getTime());
  const waiting = advanceAfterDue(reminder, new Date('2030-05-10T08:15:00').getTime());
  const active = confirmReminder(waiting, new Date('2030-05-10T08:20:00').getTime());
  assert.equal(active.status, 'active');
  assert.equal(active.triggerAt, new Date('2030-05-11T08:15:00').getTime());
});

test('confirmation rejects reminders that are not awaiting', () => {
  const reminder = createReminder({ title: 'Stretch', repeatType: 'interval', repeatIntervalSeconds: 60 }, 1_000);
  assert.throws(() => confirmReminder(reminder, 2_000), /awaiting confirmation/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/reminders.test.js`

Expected: FAIL because the transition exports and awaiting behavior do not exist.

- [ ] **Step 3: Implement the minimal transitions**

Set new fields to `null` in `createReminder`. Implement `markAwaitingConfirmation`, `confirmReminder`, and update `advanceAfterDue`; keep `firedAt` only for one-time completion and clear stale confirmation fields when rescheduling.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/reminders.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reminders.js test/reminders.test.js
git commit -m feat:pause-recurring-reminders-for-confirmation
```

### Task 2: Make the scheduler persist waiting state and avoid duplicate delivery

**Files:**
- Modify: `src/scheduler.js`
- Test: `test/scheduler.test.js`

**Interfaces:**
- Consume `advanceAfterDue` from Task 1.
- Produce scheduler behavior where a recurring due reminder is persisted as awaiting before `deliver`, and a second `checkNow()` sees no due reminder until confirmation.

- [ ] **Step 1: Write the failing tests**

Add a test using the existing inline store shape in `test/scheduler.test.js`:

```js
test('recurring delivery waits and does not advance until confirmation', async () => {
  const delivered = [];
  let reminders = [createReminder({ title: 'Stretch', repeatType: 'interval', repeatIntervalSeconds: 60 }, 1_000)];
  const store = {
    list: () => reminders.map(item => ({ ...item })),
    replaceAll: async next => { reminders = next; },
  };
  const scheduler = createScheduler({ store, deliver: async reminder => delivered.push(reminder), now: () => 61_000 });
  await scheduler.checkNow();
  await scheduler.checkNow();
  assert.equal(delivered.length, 1);
  assert.equal(store.list()[0].status, 'awaiting_confirmation');
  scheduler.stop();
});
```

Use the repository’s existing store fixture names and imports rather than introducing a second storage abstraction.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/scheduler.test.js`

Expected: FAIL because the current scheduler advances recurring reminders immediately.

- [ ] **Step 3: Implement the minimal scheduler change**

Keep the existing persist-before-delivery ordering. The `advancedById` map should now contain awaiting state for recurring reminders; delivery errors still call `onError` with that persisted state.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/scheduler.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scheduler.js test/scheduler.test.js
git commit -m feat:pause-scheduler-until-confirmed
```

### Task 3: Add the local confirmation API endpoint

**Files:**
- Modify: `src/api.js`
- Test: `test/api.test.js`

**Interfaces:**
- Add `POST /api/reminders/:id/confirm`.
- Return 200 with the active reminder after `confirmReminder`.
- Return 404 for an unknown id and 409 with `{ error: 'Reminder is not awaiting confirmation' }` for any other status.

- [ ] **Step 1: Write the failing API tests**

Create an interval reminder, advance its scheduler to awaiting state, POST to `/api/reminders/<id>/confirm`, and assert `status: 'active'` and `triggerAt` equals confirmation time plus interval. Add separate assertions for 404 and 409.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/api.test.js`

Expected: FAIL with 404 for the new route and no confirmation transition.

- [ ] **Step 3: Implement the endpoint**

Decode the id, load it from `store.list()`, call `confirmReminder(existing, now())`, persist with `store.upsert`, and send JSON 200. Map the known invalid-state error to 409 without changing existing validation/error behavior.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/api.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api.js test/api.test.js
git commit -m feat:add-reminder-confirmation-api
```

### Task 4: Register the per-user confirmation protocol

**Files:**
- Modify: `src/notification-identity.js`
- Modify: `scripts/register-notification-identity.ps1`
- Test: `test/notification-identity.test.js`

**Interfaces:**
- Extend `ensureNotificationIdentity()` to pass `-ProtocolCommandPath` pointing to `scripts/confirm-reminder.js` and `-ProtocolScheme reminderdesk`.
- PowerShell registration creates `HKCU\\Software\\Classes\\reminderdesk\\shell\\open\\command` with a quoted Node target and `%1` URI argument, without admin access.
- Existing Start-menu shortcut registration remains idempotent and is still verified by the same function.

- [ ] **Step 1: Write failing registration tests**

Update the fake spawn assertions to require the protocol parameters and add a test that the protocol command path is absolute and points inside the project’s `scripts` directory.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/notification-identity.test.js`

Expected: FAIL because protocol arguments are not passed.

- [ ] **Step 3: Implement protocol registration**

Add mandatory PowerShell parameters, create the HKCU protocol command, and keep shortcut registration in the same hidden PowerShell invocation so startup remains one idempotent operation.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/notification-identity.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notification-identity.js scripts/register-notification-identity.ps1 test/notification-identity.test.js
git commit -m feat:register-reminder-confirmation-protocol
```

### Task 5: Add a Confirm action to Windows ToastGeneric notifications

**Files:**
- Modify: `src/popup.js`
- Test: `test/popup.test.js`

**Interfaces:**
- `buildToastXml(reminder)` adds an `<actions>` block only for recurring reminders, with a `Confirm` button using `activationType="protocol"` and `arguments="reminderdesk://confirm/<id>"`.
- One-time toast XML remains visual-only.

- [ ] **Step 1: Write failing popup XML tests**

Assert a recurring fixture contains the escaped title/message and literal protocol action URI, while a one-time fixture contains no `<actions>` block. Assert reminder text and id remain in environment/XML data, not PowerShell source arguments.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/popup.test.js`

Expected: FAIL because current XML has no action block.

- [ ] **Step 3: Implement the action XML**

Add the action only when `repeatType` is `interval` or `daily`; keep the existing WinRT submission/error handling intact.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/popup.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/popup.js test/popup.test.js
git commit -m feat:add-confirm-toast-action
```

### Task 6: Implement the protocol helper that confirms through localhost

**Files:**
- Create: `scripts/confirm-reminder.js`
- Test: `test/confirm-reminder.test.js`

**Interfaces:**
- Export `parseConfirmationUri(value)` returning `{ id, port }` for `reminderdesk://confirm/<id>?port=<number>` and throwing for another scheme, missing id, or invalid port.
- Export `confirmViaLocalServer({ id, port, request = http.request })` resolving on HTTP 200 and rejecting on non-2xx or request errors.
- CLI parses `process.argv[2]`, posts `{}` to `/api/reminders/<id>/confirm`, and exits nonzero on failure.

- [ ] **Step 1: Write failing parser and request tests**

Use literal URIs and a fake `http.request` that emits a 200 response, a 409 response, and an error. Assert encoded ids are decoded and invalid schemes are rejected.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/confirm-reminder.test.js`

Expected: FAIL because the helper file does not exist.

- [ ] **Step 3: Implement the helper**

Use only Node built-ins, bind requests to `127.0.0.1`, set JSON content headers, and never log reminder text or arbitrary URI contents.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/confirm-reminder.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/confirm-reminder.js test/confirm-reminder.test.js
git commit -m feat:add-local-confirmation-helper
```

### Task 7: Add web Confirm controls and integration documentation

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `README.md`
- Test: `test/ui.test.js`

**Interfaces:**
- Awaiting cards display `Awaiting confirmation` and a `Confirm` button.
- `confirmReminderFromUi(reminder)` sends `POST /api/reminders/<id>/confirm` and reloads the list; existing edit/pause/delete actions remain unchanged.
- `groupReminders` keeps awaiting reminders in the active list until confirmed.

- [ ] **Step 1: Write failing UI helper tests**

Add a literal assertion that an awaiting reminder gets the label `Awaiting confirmation` and that the exported `getConfirmationPath(reminder)` helper returns `/api/reminders/<encoded-id>/confirm`. Keep tests focused on exported pure helpers; DOM event wiring is verified through the API integration suite.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/ui.test.js`

Expected: FAIL because awaiting label/confirmation helper is absent.

- [ ] **Step 3: Implement web confirmation**

Add the awaiting status label and Confirm action in `createCard`, implement `confirmReminderFromUi` using `getConfirmationPath`, and style the waiting state in all three skins with a distinct amber/cyan indicator.

- [ ] **Step 4: Update documentation**

Document that recurring alerts pause until Confirm, and that Confirm is available in either the Windows toast or web card.

- [ ] **Step 5: Run the full verification suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 6: Commit and push**

```bash
git add public/app.js public/styles.css README.md test/ui.test.js
git commit -m feat:confirm-recurring-reminders
git push origin main
```

Verify with `git status --short --branch` and `git ls-remote origin refs/heads/main`; both must identify the final commit and a clean local tree.
