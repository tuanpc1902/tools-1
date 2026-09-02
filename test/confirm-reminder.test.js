const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  parseConfirmationUri,
  confirmViaLocalServer,
} = require('../scripts/confirm-reminder');

test('confirmation URI parser decodes the reminder id and defaults the port', () => {
  assert.deepEqual(
    parseConfirmationUri('reminderdesk://confirm/loop%2F1'),
    { id: 'loop/1', port: 4317 },
  );
  assert.deepEqual(
    parseConfirmationUri('reminderdesk://confirm/abc?port=5000'),
    { id: 'abc', port: 5000 },
  );
});

test('confirmation URI parser rejects unsafe schemes and ports', () => {
  assert.throws(() => parseConfirmationUri('https://confirm/abc'), /reminderdesk/);
  assert.throws(() => parseConfirmationUri('reminderdesk://confirm/'), /id/);
  assert.throws(() => parseConfirmationUri('reminderdesk://confirm/abc?port=0'), /port/);
  assert.throws(() => parseConfirmationUri('reminderdesk://confirm/abc?port=bad'), /port/);
});

test('confirmation request resolves on HTTP 200 and rejects non-2xx', async () => {
  const calls = [];
  const request = (options, callback) => {
    calls.push(options);
    const response = new EventEmitter();
    response.statusCode = 200;
    queueMicrotask(() => { callback(response); response.emit('end'); });
    const client = new EventEmitter();
    client.end = () => {};
    return client;
  };
  await confirmViaLocalServer({ id: 'loop/1', port: 5000, request });
  assert.equal(calls[0].hostname, '127.0.0.1');
  assert.equal(calls[0].port, 5000);
  assert.equal(calls[0].path, '/api/reminders/loop%2F1/confirm');
  assert.equal(calls[0].method, 'POST');

  const failedRequest = (options, callback) => {
    const response = new EventEmitter();
    response.statusCode = 409;
    queueMicrotask(() => { callback(response); response.emit('end'); });
    const client = new EventEmitter();
    client.end = () => {};
    return client;
  };
  await assert.rejects(
    confirmViaLocalServer({ id: 'loop', port: 4317, request: failedRequest }),
    /409/,
  );
});
