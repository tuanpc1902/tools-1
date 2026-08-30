const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApiHandler } = require('../src/api');

function createMemoryStore() {
  let reminders = [];
  return {
    list: () => reminders.map(item => ({ ...item })),
    upsert: async reminder => {
      const index = reminders.findIndex(item => item.id === reminder.id);
      if (index === -1) reminders.push({ ...reminder });
      else reminders[index] = { ...reminder };
      return { ...reminder };
    },
    remove: async id => {
      const before = reminders.length;
      reminders = reminders.filter(item => item.id !== id);
      return reminders.length !== before;
    },
  };
}

async function withApi(callback) {
  const store = createMemoryStore();
  const handler = createApiHandler({ store, now: () => 1_000 });
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`, store);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('API creates, lists, edits, disables, and deletes a reminder', async () => {
  await withApi(async baseUrl => {
    const createdResponse = await fetch(`${baseUrl}/api/reminders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Tea', mode: 'countdown', durationSeconds: 60 }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.triggerAt, 61_000);

    const listed = await (await fetch(`${baseUrl}/api/reminders`)).json();
    assert.equal(listed.length, 1);

    const editedResponse = await fetch(`${baseUrl}/api/reminders/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Green tea', enabled: false }),
    });
    assert.equal(editedResponse.status, 200);
    const edited = await editedResponse.json();
    assert.equal(edited.title, 'Green tea');
    assert.equal(edited.status, 'disabled');

    const deleted = await fetch(`${baseUrl}/api/reminders/${created.id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);
    assert.deepEqual(await (await fetch(`${baseUrl}/api/reminders`)).json(), []);
  });
});

test('API returns structured client errors for invalid requests', async () => {
  await withApi(async baseUrl => {
    const invalid = await fetch(`${baseUrl}/api/reminders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '', mode: 'countdown', durationSeconds: 0 }),
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /title/i);

    const malformed = await fetch(`${baseUrl}/api/reminders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad',
    });
    assert.equal(malformed.status, 400);
    assert.match((await malformed.json()).error, /json/i);
  });
});

test('API returns 404 for missing reminders and routes', async () => {
  await withApi(async baseUrl => {
    const missingReminder = await fetch(`${baseUrl}/api/reminders/not-here`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Nope' }),
    });
    assert.equal(missingReminder.status, 404);

    const missingRoute = await fetch(`${baseUrl}/api/unknown`);
    assert.equal(missingRoute.status, 404);
    assert.deepEqual(await missingRoute.json(), { error: 'Not found' });
  });
});

test('API rejects request bodies larger than 64 KiB', async () => {
  await withApi(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/reminders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Big', message: 'x'.repeat(66_000), mode: 'countdown', durationSeconds: 1 }),
    });
    assert.equal(response.status, 413);
  });
});

test('API creates and converts interval and daily repeat policies', async () => {
  await withApi(async baseUrl => {
    const intervalResponse = await fetch(`${baseUrl}/api/reminders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Stretch', repeatType: 'interval', repeatIntervalSeconds: 300 }),
    });
    assert.equal(intervalResponse.status, 201);
    const interval = await intervalResponse.json();
    assert.equal(interval.mode, 'countdown');
    assert.equal(interval.triggerAt, 301_000);
    assert.equal(interval.repeatIntervalSeconds, 300);
    assert.equal(interval.dailyTime, null);

    const dailyResponse = await fetch(`${baseUrl}/api/reminders/${interval.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repeatType: 'daily', dailyTime: '08:15' }),
    });
    assert.equal(dailyResponse.status, 200);
    const daily = await dailyResponse.json();
    assert.equal(daily.mode, 'datetime');
    assert.equal(daily.repeatType, 'daily');
    assert.equal(daily.repeatIntervalSeconds, null);
    assert.equal(daily.dailyTime, '08:15');
    assert.ok(daily.triggerAt > 1_000);
  });
});
