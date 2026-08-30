const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { ensureNotificationIdentity } = require('../src/notification-identity');

const options = {
  appData: 'C:\\Users\\Me\\AppData\\Roaming',
  projectRoot: 'C:\\ReminderDesk',
  execPath: 'C:\\node\\node.exe',
};

function missingAccess() {
  const error = new Error('missing');
  error.code = 'ENOENT';
  throw error;
}

function spawnWithExit(exitCode, calls) {
  return function spawn(command, args, spawnOptions) {
    calls.push({ command, args, options: spawnOptions });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('exit', exitCode));
    return child;
  };
}

test('existing notification shortcut skips registration', async () => {
  let spawnCount = 0;
  const result = await ensureNotificationIdentity({
    ...options,
    access: async () => {},
    spawn: () => { spawnCount += 1; },
  });

  assert.equal(result.created, false);
  assert.equal(spawnCount, 0);
  assert.equal(
    result.shortcutPath,
    'C:\\Users\\Me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Reminder Desk.lnk',
  );
});

test('missing shortcut launches per-user registration with absolute paths', async () => {
  const calls = [];
  const result = await ensureNotificationIdentity({
    ...options,
    access: async () => missingAccess(),
    spawn: spawnWithExit(0, calls),
  });

  assert.equal(result.created, true);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.command, 'powershell.exe');
  assert.equal(call.options.shell, false);
  assert.equal(call.options.windowsHide, true);
  assert.deepEqual(call.options.stdio, ['ignore', 'ignore', 'pipe']);

  const valueAfter = flag => call.args[call.args.indexOf(flag) + 1];
  assert.equal(valueAfter('-AppId'), 'ReminderDesk.Local');
  assert.equal(valueAfter('-TargetPath'), options.execPath);
  assert.equal(valueAfter('-WorkingDirectory'), options.projectRoot);
  assert.equal(valueAfter('-EntryPath'), path.join(options.projectRoot, 'src', 'index.js'));
  assert.equal(valueAfter('-ShortcutPath'), result.shortcutPath);
  assert.equal(path.isAbsolute(valueAfter('-File')), true);
});

test('registration reports PowerShell stderr on non-zero exit', async () => {
  function spawn() {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      child.stderr.emit('data', Buffer.from('registration denied'));
      child.emit('exit', 7);
    });
    return child;
  }

  await assert.rejects(
    ensureNotificationIdentity({ ...options, access: async () => missingAccess(), spawn }),
    /registration denied.*code 7/i,
  );
});

test('registration rejects launch errors and non-missing access errors', async () => {
  function spawn() {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => child.emit('error', new Error('PowerShell unavailable')));
    return child;
  }
  await assert.rejects(
    ensureNotificationIdentity({ ...options, access: async () => missingAccess(), spawn }),
    /PowerShell unavailable/,
  );

  const denied = new Error('access denied');
  denied.code = 'EACCES';
  await assert.rejects(
    ensureNotificationIdentity({ ...options, access: async () => { throw denied; }, spawn }),
    /access denied/,
  );
});
