const { spawn: nodeSpawn } = require('node:child_process');

const { APP_ID } = require('./notification-identity');

const TOAST_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
  '[Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
  '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
  '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
  '$xml.LoadXml($env:REMINDER_TOAST_XML)',
  '$toast = New-Object Windows.UI.Notifications.ToastNotification $xml',
  '$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:REMINDER_APP_ID)',
  '$notifier.Show($toast)',
].join('\n');

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function buildToastXml(reminder) {
  const title = `<text>${escapeXml(reminder.title)}</text>`;
  const message = reminder.message
    ? `<text>${escapeXml(reminder.message)}</text>`
    : '';
  return `<toast><visual><binding template="ToastGeneric">${title}${message}</binding></visual></toast>`;
}

function showWindowsPopup(reminder, { spawn = nodeSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', TOAST_SCRIPT],
      {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        env: {
          ...process.env,
          REMINDER_APP_ID: APP_ID,
          REMINDER_TOAST_XML: buildToastXml(reminder),
        },
      },
    );

    let stderr = '';
    let settled = false;
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.once('error', error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('exit', code => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim();
      reject(new Error(`Windows toast submission failed${detail ? `: ${detail}` : ''} (exit code ${code})`));
    });
  });
}

module.exports = { buildToastXml, showWindowsPopup };
