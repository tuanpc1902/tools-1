const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createReminder,
  applyReminderPatch,
  getDueReminders,
  markFired,
  getNextDailyTrigger,
  advanceAfterDue,
  markAwaitingConfirmation,
  confirmReminder,
} = require('../src/reminders');

test('countdown input becomes an absolute trigger timestamp', () => {
  const reminder = createReminder(
    { title: ' Stretch ', message: ' Stand up ', mode: 'countdown', durationSeconds: 90 },
    1_000,
  );

  assert.equal(reminder.title, 'Stretch');
  assert.equal(reminder.message, 'Stand up');
  assert.equal(reminder.triggerAt, 91_000);
  assert.equal(reminder.status, 'active');
  assert.equal(reminder.createdAt, 1_000);
  assert.equal(reminder.alertedAt, null);
  assert.equal(reminder.confirmedAt, null);
});

test('date/time reminders reject timestamps that are not in the future', () => {
  assert.throws(
    () => createReminder({ title: 'Late', mode: 'datetime', triggerAt: 999 }, 1_000),
    /future/,
  );
});

test('countdown reminders reject non-positive durations', () => {
  assert.throws(
    () => createReminder({ title: 'Tea', mode: 'countdown', durationSeconds: 0 }, 1_000),
    /positive/,
  );
});

test('reminders require a non-empty title', () => {
  assert.throws(
    () => createReminder({ title: '   ', mode: 'countdown', durationSeconds: 1 }, 1_000),
    /title/i,
  );
});

test('patches preserve identity and can reschedule a fired reminder', () => {
  const existing = {
    id: 'reminder-1',
    title: 'Old',
    message: '',
    mode: 'datetime',
    triggerAt: 500,
    status: 'fired',
    createdAt: 100,
    firedAt: 500,
  };

  const patched = applyReminderPatch(
    existing,
    { title: 'New', mode: 'countdown', durationSeconds: 5 },
    1_000,
  );

  assert.equal(patched.id, 'reminder-1');
  assert.equal(patched.createdAt, 100);
  assert.equal(patched.title, 'New');
  assert.equal(patched.triggerAt, 6_000);
  assert.equal(patched.status, 'active');
  assert.equal(patched.firedAt, null);
});

test('enabled patches toggle only active and disabled reminders', () => {
  const active = createReminder(
    { title: 'Tea', mode: 'countdown', durationSeconds: 10 },
    1_000,
  );
  const disabled = applyReminderPatch(active, { enabled: false }, 2_000);
  const enabled = applyReminderPatch(disabled, { enabled: true }, 3_000);

  assert.equal(disabled.status, 'disabled');
  assert.equal(enabled.status, 'active');
});

test('due selection includes only active reminders at or before now', () => {
  const reminders = [
    { id: 'due', status: 'active', triggerAt: 5_000 },
    { id: 'future', status: 'active', triggerAt: 5_001 },
    { id: 'disabled', status: 'disabled', triggerAt: 4_000 },
    { id: 'fired', status: 'fired', triggerAt: 4_000 },
  ];

  assert.deepEqual(getDueReminders(reminders, 5_000).map(item => item.id), ['due']);
});

test('markFired records a one-time terminal state', () => {
  const reminder = { id: 'due', status: 'active', triggerAt: 5_000, firedAt: null };
  const fired = markFired(reminder, 5_100);

  assert.equal(fired.status, 'fired');
  assert.equal(fired.firedAt, 5_100);
  assert.equal(reminder.status, 'active');
});

test('interval repeats derive their first trigger and normalized fields', () => {
  const reminder = createReminder(
    { title: 'Stretch', repeatType: 'interval', repeatIntervalSeconds: 90 },
    1_000,
  );

  assert.equal(reminder.mode, 'countdown');
  assert.equal(reminder.triggerAt, 91_000);
  assert.equal(reminder.repeatType, 'interval');
  assert.equal(reminder.repeatIntervalSeconds, 90);
  assert.equal(reminder.dailyTime, null);
});

test('daily repeats derive the next local occurrence', () => {
  const now = new Date(2030, 0, 2, 8, 0).getTime();
  const expected = new Date(2030, 0, 2, 9, 30).getTime();
  const reminder = createReminder(
    { title: 'Stand-up', repeatType: 'daily', dailyTime: '09:30' },
    now,
  );

  assert.equal(reminder.mode, 'datetime');
  assert.equal(reminder.triggerAt, expected);
  assert.equal(reminder.repeatType, 'daily');
  assert.equal(reminder.repeatIntervalSeconds, null);
  assert.equal(reminder.dailyTime, '09:30');
});

test('daily calculation rolls to the next local calendar day', () => {
  const now = new Date(2030, 0, 2, 10, 0).getTime();
  const expected = new Date(2030, 0, 3, 9, 30).getTime();
  assert.equal(getNextDailyTrigger('09:30', now), expected);
});

test('repeat policies reject invalid intervals and daily times', () => {
  assert.throws(
    () => createReminder({ title: 'Bad', repeatType: 'interval', repeatIntervalSeconds: 0 }, 1_000),
    /positive/,
  );
  for (const dailyTime of ['24:00', '09:60', '9:30', 'noon']) {
    assert.throws(
      () => createReminder({ title: 'Bad', repeatType: 'daily', dailyTime }, 1_000),
      /HH:MM/,
    );
  }
});

test('overdue interval advances past missed occurrences without completing', () => {
  const reminder = {
    id: 'loop',
    status: 'active',
    triggerAt: 1_000,
    repeatType: 'interval',
    repeatIntervalSeconds: 10,
    firedAt: null,
  };
  const advanced = advanceAfterDue(reminder, 35_000);

  assert.equal(advanced.status, 'awaiting_confirmation');
  assert.equal(advanced.triggerAt, 1_000);
  assert.equal(advanced.alertedAt, 35_000);
});

test('recurring due reminders wait for confirmation without advancing', () => {
  const reminder = createReminder({ title: 'Stretch', repeatType: 'interval', repeatIntervalSeconds: 60 }, 1_000);
  const waiting = markAwaitingConfirmation(reminder, 61_000);
  assert.equal(waiting.status, 'awaiting_confirmation');
  assert.equal(waiting.triggerAt, reminder.triggerAt);
  assert.equal(waiting.alertedAt, 61_000);
  assert.equal(reminder.status, 'active');
});

test('confirmation starts the next interval from the confirmation time', () => {
  const reminder = createReminder({ title: 'Stretch', repeatType: 'interval', repeatIntervalSeconds: 60 }, 1_000);
  const waiting = markAwaitingConfirmation(reminder, 61_000);
  const active = confirmReminder(waiting, 90_000);
  assert.equal(active.status, 'active');
  assert.equal(active.triggerAt, 150_000);
  assert.equal(active.confirmedAt, 90_000);
  assert.equal(active.alertedAt, null);
});

test('daily confirmation schedules the next local occurrence', () => {
  const reminder = createReminder({ title: 'Review', repeatType: 'daily', dailyTime: '08:15' }, new Date('2030-05-10T07:00:00').getTime());
  const waiting = markAwaitingConfirmation(reminder, new Date('2030-05-10T08:15:00').getTime());
  const active = confirmReminder(waiting, new Date('2030-05-10T08:20:00').getTime());
  assert.equal(active.status, 'active');
  assert.equal(active.triggerAt, new Date('2030-05-11T08:15:00').getTime());
});

test('confirmation rejects reminders that are not awaiting', () => {
  const reminder = createReminder({ title: 'Stretch', repeatType: 'interval', repeatIntervalSeconds: 60 }, 1_000);
  assert.throws(() => confirmReminder(reminder, 2_000), /awaiting confirmation/);
});

test('legacy reminders without repeat metadata complete once', () => {
  const advanced = advanceAfterDue(
    { id: 'old', status: 'active', triggerAt: 500, firedAt: null },
    1_000,
  );
  assert.equal(advanced.status, 'fired');
  assert.equal(advanced.firedAt, 1_000);
});

test('patching a repeat policy reschedules and clears irrelevant fields', () => {
  const existing = createReminder(
    { title: 'Loop', repeatType: 'interval', repeatIntervalSeconds: 60 },
    1_000,
  );
  const now = new Date(2030, 0, 2, 8, 0).getTime();
  const patched = applyReminderPatch(
    existing,
    { repeatType: 'daily', dailyTime: '09:30' },
    now,
  );

  assert.equal(patched.repeatType, 'daily');
  assert.equal(patched.repeatIntervalSeconds, null);
  assert.equal(patched.dailyTime, '09:30');
  assert.equal(patched.triggerAt, new Date(2030, 0, 2, 9, 30).getTime());
  assert.equal(patched.status, 'active');
});
