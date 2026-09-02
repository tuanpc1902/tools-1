const test = require('node:test');
const assert = require('node:assert/strict');

const { createScheduler } = require('../src/scheduler');
const { createReminder } = require('../src/reminders');

test('due reminders are persisted as fired before delivery', async () => {
  let reminders = [
    { id: 'due', title: 'Tea', status: 'active', triggerAt: 4_000, firedAt: null },
    { id: 'future', title: 'Later', status: 'active', triggerAt: 6_000, firedAt: null },
    { id: 'off', title: 'Off', status: 'disabled', triggerAt: 3_000, firedAt: null },
  ];
  const events = [];
  const store = {
    list: () => reminders.map(item => ({ ...item })),
    replaceAll: async next => {
      events.push('persist');
      reminders = next;
    },
  };
  const scheduler = createScheduler({
    store,
    deliver: async reminder => events.push(`deliver:${reminder.id}`),
    now: () => 5_000,
    intervalMs: 60_000,
  });

  await scheduler.checkNow();
  await scheduler.checkNow();
  scheduler.stop();

  assert.deepEqual(events, ['persist', 'deliver:due']);
  assert.equal(reminders[0].status, 'fired');
  assert.equal(reminders[0].firedAt, 5_000);
});

test('a delivery error is reported without reactivating the reminder', async () => {
  let reminders = [{ id: 'due', status: 'active', triggerAt: 1 }];
  const errors = [];
  const store = {
    list: () => reminders,
    replaceAll: async next => { reminders = next; },
  };
  const scheduler = createScheduler({
    store,
    deliver: async () => { throw new Error('popup failed'); },
    onError: error => errors.push(error.message),
    now: () => 2,
    intervalMs: 60_000,
  });

  await scheduler.checkNow();
  scheduler.stop();

  assert.equal(reminders[0].status, 'fired');
  assert.deepEqual(errors, ['popup failed']);
});

test('mixed due reminders complete once or advance according to repeat policy', async () => {
  const now = new Date(2030, 0, 2, 10, 0).getTime();
  let reminders = [
    { id: 'once', title: 'Once', status: 'active', triggerAt: now - 1, repeatType: 'none', firedAt: null },
    { id: 'loop', title: 'Loop', status: 'active', triggerAt: now - 5_000, repeatType: 'interval', repeatIntervalSeconds: 10, firedAt: null },
    { id: 'daily', title: 'Daily', status: 'active', triggerAt: now - 1, repeatType: 'daily', dailyTime: '09:00', firedAt: null },
  ];
  const events = [];
  const delivered = [];
  const store = {
    list: () => reminders.map(item => ({ ...item })),
    replaceAll: async next => {
      events.push('persist');
      reminders = next;
    },
  };
  const scheduler = createScheduler({
    store,
    deliver: async reminder => {
      events.push(`deliver:${reminder.id}`);
      delivered.push(reminder.id);
    },
    now: () => now,
    intervalMs: 60_000,
  });

  await scheduler.checkNow();
  scheduler.stop();

  assert.equal(reminders.find(item => item.id === 'once').status, 'fired');
  assert.equal(reminders.find(item => item.id === 'loop').status, 'awaiting_confirmation');
  assert.equal(reminders.find(item => item.id === 'loop').triggerAt, now - 5_000);
  assert.equal(reminders.find(item => item.id === 'daily').status, 'awaiting_confirmation');
  assert.equal(reminders.find(item => item.id === 'daily').triggerAt, now - 1);
  assert.deepEqual(events, ['persist', 'deliver:once', 'deliver:loop', 'deliver:daily']);
  assert.deepEqual(delivered.sort(), ['daily', 'loop', 'once']);
});

test('an overdue interval skips missed cycles and delivers only once', async () => {
  let reminders = [{
    id: 'loop',
    title: 'Loop',
    status: 'active',
    triggerAt: 1_000,
    repeatType: 'interval',
    repeatIntervalSeconds: 10,
    firedAt: null,
  }];
  const delivered = [];
  const store = {
    list: () => reminders.map(item => ({ ...item })),
    replaceAll: async next => { reminders = next; },
  };
  const scheduler = createScheduler({
    store,
    deliver: async reminder => delivered.push(reminder.id),
    now: () => 55_000,
    intervalMs: 60_000,
  });

  await scheduler.checkNow();
  scheduler.stop();

  assert.equal(reminders[0].triggerAt, 1_000);
  assert.equal(reminders[0].status, 'awaiting_confirmation');
  assert.deepEqual(delivered, ['loop']);
});

test('recurring delivery waits and does not advance until confirmation', async () => {
  const delivered = [];
  let reminders = [createReminder({ title: 'Stretch', repeatType: 'interval', repeatIntervalSeconds: 60 }, 1_000)];
  const store = {
    list: () => reminders.map(item => ({ ...item })),
    replaceAll: async next => { reminders = next; },
  };
  const scheduler = createScheduler({
    store,
    deliver: async reminder => delivered.push(reminder),
    now: () => 61_000,
    intervalMs: 60_000,
  });

  await scheduler.checkNow();
  await scheduler.checkNow();
  scheduler.stop();

  assert.equal(delivered.length, 1);
  assert.equal(store.list()[0].status, 'awaiting_confirmation');
});
