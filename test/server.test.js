const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

const { createAppServer, prepareNotificationIdentity } = require('../src/index');

async function withServer(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'reminder-server-'));
  let currentNow = 1_000;
  const delivered = [];
  const app = await createAppServer({
    dataFile: path.join(directory, 'reminders.json'),
    publicDir: path.resolve(__dirname, '..', 'public'),
    deliver: async reminder => delivered.push(reminder),
    now: () => currentNow,
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  try {
    await callback({
      ...app,
      baseUrl: `http://127.0.0.1:${port}`,
      delivered,
      setNow(value) { currentNow = value; },
    });
  } finally {
    app.scheduler.stop();
    await new Promise(resolve => app.server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

function rawRequest(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: requestPath }, response => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    request.once('error', reject);
  });
}

test('notification identity preparation returns the registration result', async () => {
  const expected = { created: true, shortcutPath: 'Reminder Desk.lnk' };
  const result = await prepareNotificationIdentity({
    ensureIdentity: async () => expected,
    onWarning: () => assert.fail('successful registration must not warn'),
  });

  assert.equal(result, expected);
});

test('notification identity failure warns and allows startup to continue', async () => {
  const warnings = [];
  const result = await prepareNotificationIdentity({
    ensureIdentity: async () => { throw new Error('shortcut denied'); },
    onWarning: message => warnings.push(message),
  });

  assert.equal(result, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Windows notifications are unavailable/);
  assert.match(warnings[0], /shortcut denied/);
});

test('server serves the UI assets with their correct content types', async () => {
  await withServer(async ({ baseUrl }) => {
    const page = await fetch(`${baseUrl}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    assert.match(await page.text(), /Reminder Desk/);

    const css = await fetch(`${baseUrl}/styles.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /^text\/css/);

    const script = await fetch(`${baseUrl}/app.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /^text\/javascript/);
  });
});

test('server blocks traversal and returns 404 for missing assets', async () => {
  await withServer(async ({ baseUrl, server }) => {
    assert.equal((await fetch(`${baseUrl}/missing.css`)).status, 404);
    assert.equal(await rawRequest(server.address().port, '/..%2fpackage.json'), 404);
  });
});

test('API and scheduler share durable reminder state', async () => {
  await withServer(async ({ baseUrl, scheduler, delivered, setNow }) => {
    const createdResponse = await fetch(`${baseUrl}/api/reminders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Tea', mode: 'countdown', durationSeconds: 1 }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();

    setNow(2_001);
    await scheduler.checkNow();
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].id, created.id);

    const listed = await (await fetch(`${baseUrl}/api/reminders`)).json();
    assert.equal(listed[0].status, 'fired');
  });
});

test('API interval reminder waits for confirmation before starting its next cycle', async () => {
  await withServer(async ({ baseUrl, scheduler, delivered, setNow }) => {
    const createdResponse = await fetch(`${baseUrl}/api/reminders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Stretch', repeatType: 'interval', repeatIntervalSeconds: 10 }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.triggerAt, 11_000);

    setNow(56_000);
    await scheduler.checkNow();

    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].id, created.id);
    const listed = await (await fetch(`${baseUrl}/api/reminders`)).json();
    assert.equal(listed[0].id, created.id);
    assert.equal(listed[0].status, 'awaiting_confirmation');
    assert.equal(listed[0].triggerAt, 11_000);

    const confirmedResponse = await fetch(`${baseUrl}/api/reminders/${created.id}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(confirmedResponse.status, 200);
    const confirmed = await confirmedResponse.json();
    assert.equal(confirmed.status, 'active');
    assert.equal(confirmed.triggerAt, 66_000);
  });
});
