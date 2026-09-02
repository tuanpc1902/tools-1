const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { APP_ID } = require('../src/notification-identity');
const { buildToastXml, showWindowsPopup } = require('../src/popup');

function exitingSpawnRecorder({ exitCode = 0, stderr = '' } = {}) {
  const calls = [];
  function spawn(command, args, options) {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.unref = () => {};
    queueMicrotask(() => {
      child.emit('spawn');
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('exit', exitCode);
    });
    return child;
  }
  return { calls, spawn };
}

test('toast XML escapes reminder text and includes an optional message', () => {
  assert.equal(
    buildToastXml({ title: 'Tea & <water>', message: 'Use "blue" > red' }),
    '<toast><visual><binding template="ToastGeneric"><text>Tea &amp; &lt;water&gt;</text><text>Use &quot;blue&quot; &gt; red</text></binding></visual></toast>',
  );
  assert.equal(
    buildToastXml({ title: "Tea's ready", message: '' }),
    '<toast><visual><binding template="ToastGeneric"><text>Tea&apos;s ready</text></binding></visual></toast>',
  );
});

test('recurring toast includes a Confirm protocol action', () => {
  assert.equal(
    buildToastXml({ id: 'loop/1', title: 'Stretch', message: '', repeatType: 'interval' }),
    '<toast><visual><binding template="ToastGeneric"><text>Stretch</text></binding></visual><actions><action content="Confirm" activationType="protocol" arguments="reminderdesk://confirm/loop%2F1"/></actions></toast>',
  );
  assert.doesNotMatch(
    buildToastXml({ id: 'once', title: 'Tea', message: '', repeatType: 'none' }),
    /<actions>/,
  );
});

test('popup submits ToastGeneric XML using the registered app identity', async () => {
  const recorder = exitingSpawnRecorder();
  await showWindowsPopup(
    { title: "Don't interpolate", message: 'Text with $() and `ticks`' },
    { spawn: recorder.spawn },
  );

  const call = recorder.calls[0];
  assert.equal(call.command, 'powershell.exe');
  assert.equal(call.options.shell, false);
  assert.equal(call.options.windowsHide, true);
  assert.deepEqual(call.options.stdio, ['ignore', 'ignore', 'pipe']);
  assert.equal(call.options.env.REMINDER_APP_ID, APP_ID);
  assert.match(call.options.env.REMINDER_TOAST_XML, /ToastGeneric/);
  assert.match(call.options.env.REMINDER_TOAST_XML, /Text with \$\(\) and `ticks`/);
  assert.equal(call.args.some(argument => argument.includes("Don't interpolate")), false);
  assert.equal(call.args.some(argument => argument.includes('Text with $()')), false);
  assert.equal(call.args.some(argument => argument.includes('System.Windows.Forms')), false);
});

test('popup rejects when PowerShell cannot launch', async () => {
  function spawn() {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('error', new Error('missing')));
    return child;
  }

  await assert.rejects(
    showWindowsPopup({ title: 'Tea', message: '' }, { spawn }),
    /missing/,
  );
});

test('popup reports PowerShell stderr on a failed toast submission', async () => {
  const recorder = exitingSpawnRecorder({ exitCode: 7, stderr: 'toast unavailable' });

  await assert.rejects(
    showWindowsPopup({ title: 'Tea', message: '' }, { spawn: recorder.spawn }),
    /toast unavailable.*7|7.*toast unavailable/,
  );
});
