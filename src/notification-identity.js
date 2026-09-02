const path = require('node:path');
const { access: nodeAccess } = require('node:fs/promises');
const { spawn: nodeSpawn } = require('node:child_process');

const APP_ID = 'ReminderDesk.Local';
const SHORTCUT_NAME = 'Reminder Desk.lnk';

async function ensureNotificationIdentity({
  appData = process.env.APPDATA,
  projectRoot = path.resolve(__dirname, '..'),
  execPath = process.execPath,
  access = nodeAccess,
  spawn = nodeSpawn,
} = {}) {
  if (!appData) throw new Error('APPDATA is unavailable; cannot register Windows notifications');

  const shortcutPath = path.join(
    appData,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    SHORTCUT_NAME,
  );

  let shortcutExists = false;
  try {
    await access(shortcutPath);
    shortcutExists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const registrationScript = path.resolve(projectRoot, 'scripts', 'register-notification-identity.ps1');
  const entryPath = path.resolve(projectRoot, 'src', 'index.js');
  const protocolCommandPath = path.resolve(projectRoot, 'scripts', 'confirm-reminder.js');

  await new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        registrationScript,
        '-ShortcutPath',
        shortcutPath,
        '-TargetPath',
        execPath,
        '-EntryPath',
        entryPath,
        '-WorkingDirectory',
        projectRoot,
        '-AppId',
        APP_ID,
        '-ProtocolScheme',
        'reminderdesk',
        '-ProtocolCommandPath',
        protocolCommandPath,
      ],
      {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    let settled = false;
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('exit', code => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve();
      else reject(new Error(`Notification identity registration failed${stderr ? `: ${stderr.trim()}` : ''} (code ${code})`));
    });
  });

  return { created: !shortcutExists, shortcutPath };
}

module.exports = { APP_ID, SHORTCUT_NAME, ensureNotificationIdentity };
