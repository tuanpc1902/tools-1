const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getCountdownSeconds,
  getDateTimeTimestamp,
  formatRemaining,
  groupReminders,
  getRepeatPayload,
  getRepeatLabel,
  getTimingTone,
  normalizeViewMode,
  getNextViewMode,
} = require('../public/app');

test('countdown fields convert to one positive total', () => {
  assert.equal(getCountdownSeconds({ hours: '1', minutes: '2', seconds: '3' }), 3_723);
  assert.throws(() => getCountdownSeconds({ hours: '0', minutes: '0', seconds: '0' }), /greater than zero/);
  assert.throws(() => getCountdownSeconds({ hours: '-1', minutes: '0', seconds: '0' }), /whole positive/);
});

test('local date/time values convert to a future timestamp', () => {
  const value = '2030-05-10T09:30';
  assert.equal(getDateTimeTimestamp(value, 1_000), new Date(value).getTime());
  assert.throws(() => getDateTimeTimestamp('1970-01-01T00:00', Date.now()), /future/);
  assert.throws(() => getDateTimeTimestamp('', Date.now()), /date and time/);
});

test('remaining time is formatted without negative values', () => {
  assert.equal(formatRemaining(3_723_000), '1h 02m 03s');
  assert.equal(formatRemaining(62_000), '1m 02s');
  assert.equal(formatRemaining(-1), 'Due now');
});

test('timeline urgency changes at due and five-minute boundaries', () => {
  assert.equal(getTimingTone(-1), 'due');
  assert.equal(getTimingTone(0), 'due');
  assert.equal(getTimingTone(1), 'soon');
  assert.equal(getTimingTone(300_000), 'soon');
  assert.equal(getTimingTone(300_001), 'scheduled');
});

test('view mode toggle cycles Aurora, Focus, and Daylight safely', () => {
  assert.equal(normalizeViewMode('aurora'), 'aurora');
  assert.equal(normalizeViewMode('focus'), 'focus');
  assert.equal(normalizeViewMode('daylight'), 'daylight');
  assert.equal(normalizeViewMode('anything-else'), 'aurora');
  assert.equal(getNextViewMode('aurora'), 'focus');
  assert.equal(getNextViewMode('focus'), 'daylight');
  assert.equal(getNextViewMode('daylight'), 'aurora');
});

test('reminders group active first by trigger time and completed newest first', () => {
  const result = groupReminders([
    { id: 'done-old', status: 'fired', triggerAt: 100, firedAt: 200 },
    { id: 'later', status: 'active', triggerAt: 500 },
    { id: 'off', status: 'disabled', triggerAt: 300 },
    { id: 'sooner', status: 'active', triggerAt: 200 },
    { id: 'done-new', status: 'fired', triggerAt: 50, firedAt: 400 },
  ]);

  assert.deepEqual(result.active.map(item => item.id), ['sooner', 'off', 'later']);
  assert.deepEqual(result.completed.map(item => item.id), ['done-new', 'done-old']);
});

test('repeat form values convert to interval and daily API fields', () => {
  assert.deepEqual(
    getRepeatPayload({ repeatType: 'interval', hours: '0', minutes: '5', seconds: '0' }),
    { repeatType: 'interval', repeatIntervalSeconds: 300 },
  );
  assert.deepEqual(
    getRepeatPayload({ repeatType: 'daily', dailyTime: '08:15' }),
    { repeatType: 'daily', dailyTime: '08:15' },
  );
  assert.deepEqual(getRepeatPayload({ repeatType: 'none' }), { repeatType: 'none' });
});

test('repeat form rejects invalid daily time', () => {
  assert.throws(
    () => getRepeatPayload({ repeatType: 'daily', dailyTime: '' }),
    /daily time/i,
  );
  assert.throws(
    () => getRepeatPayload({ repeatType: 'daily', dailyTime: '25:00' }),
    /daily time/i,
  );
});

test('repeat labels describe saved policies and legacy reminders', () => {
  assert.equal(getRepeatLabel({ repeatType: 'interval', repeatIntervalSeconds: 300 }), 'Every 5 minutes');
  assert.equal(getRepeatLabel({ repeatType: 'interval', repeatIntervalSeconds: 90 }), 'Every 1 minute 30 seconds');
  assert.equal(getRepeatLabel({ repeatType: 'daily', dailyTime: '08:15' }), 'Daily at 08:15');
  assert.equal(getRepeatLabel({}), 'One time');
});
