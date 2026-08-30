const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, readdir, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { createStore } = require('../src/storage');

async function withTempStore(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'reminder-store-'));
  try {
    await callback(path.join(directory, 'reminders.json'), directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('missing storage loads as an empty reminder list', async () => {
  await withTempStore(async filePath => {
    const store = createStore(filePath);
    assert.deepEqual(await store.load(), []);
    assert.deepEqual(store.list(), []);
  });
});

test('upsert and remove persist across store instances', async () => {
  await withTempStore(async filePath => {
    const reminder = { id: 'one', title: 'Tea' };
    const first = createStore(filePath);
    await first.load();
    await first.upsert(reminder);

    const second = createStore(filePath);
    assert.deepEqual(await second.load(), [reminder]);
    await second.remove('one');

    const third = createStore(filePath);
    assert.deepEqual(await third.load(), []);
  });
});

test('malformed storage is backed up and reported', async () => {
  await withTempStore(async (filePath, directory) => {
    await writeFile(filePath, '{broken', 'utf8');
    const warnings = [];
    const store = createStore(filePath, { onWarning: message => warnings.push(message) });

    assert.deepEqual(await store.load(), []);
    const names = await readdir(directory);
    assert.equal(names.some(name => /^reminders\.corrupt-\d+\.json$/.test(name)), true);
    assert.match(warnings[0], /backed up/i);
  });
});

test('list returns a copy that cannot mutate stored state', async () => {
  await withTempStore(async filePath => {
    const store = createStore(filePath);
    await store.load();
    await store.upsert({ id: 'one', title: 'Tea' });
    const listed = store.list();
    listed.length = 0;
    assert.equal(store.list().length, 1);
  });
});
