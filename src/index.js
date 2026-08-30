const http = require('node:http');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { spawn } = require('node:child_process');

const { createStore } = require('./storage');
const { createScheduler } = require('./scheduler');
const { createApiHandler } = require('./api');
const { showWindowsPopup } = require('./popup');
const { ensureNotificationIdentity } = require('./notification-identity');

const STATIC_FILES = new Map([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/styles.css', { file: 'styles.css', type: 'text/css; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
]);

function fallbackAlert(error, reminder) {
  const title = reminder?.title || 'Unknown reminder';
  const message = reminder?.message || '(no note)';
  const line = '='.repeat(64);
  console.error(`\n${line}\nREMINDER: ${title}\n${message}\nPopup failed: ${error.message}\n${line}\n`);
}

async function prepareNotificationIdentity({
  ensureIdentity = ensureNotificationIdentity,
  onWarning = message => console.warn(`[notifications] ${message}`),
} = {}) {
  try {
    return await ensureIdentity();
  } catch (error) {
    onWarning(`Windows notifications are unavailable: ${error.message}. Due reminders will be printed in this window.`);
    return null;
  }
}

async function serveStatic(request, response, publicDir) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400);
    return response.end('Bad request');
  }

  const asset = STATIC_FILES.get(pathname);
  if (request.method !== 'GET' || !asset) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return response.end('Not found');
  }

  try {
    const content = await readFile(path.join(publicDir, asset.file));
    response.writeHead(200, {
      'content-type': asset.type,
      'content-length': content.length,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    response.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    throw error;
  }
}

async function createAppServer({
  dataFile = path.resolve(__dirname, '..', 'data', 'reminders.json'),
  publicDir = path.resolve(__dirname, '..', 'public'),
  deliver = showWindowsPopup,
  now = Date.now,
  onWarning = message => console.warn(`[storage] ${message}`),
  onDeliveryError = fallbackAlert,
} = {}) {
  const store = createStore(dataFile, { onWarning });
  await store.load();
  const apiHandler = createApiHandler({ store, now });
  const scheduler = createScheduler({
    store,
    deliver,
    now,
    onError: onDeliveryError,
  });

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const operation = pathname.startsWith('/api/')
      ? apiHandler(request, response)
      : serveStatic(request, response, publicDir);
    Promise.resolve(operation).catch(error => {
      console.error(error);
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Internal server error');
    });
  });

  return { server, scheduler, store };
}

function openBrowser(url) {
  const child = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', url], {
    shell: false,
    windowsHide: true,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  child.once('error', error => console.warn(`Could not open the browser automatically: ${error.message}`));
}

async function main() {
  const port = Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError('PORT must be an integer between 1 and 65535');
  }

  await prepareNotificationIdentity();
  const app = await createAppServer();
  app.server.once('error', error => {
    console.error(`Could not start Reminder Desk: ${error.message}`);
    process.exitCode = 1;
  });
  app.server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log('\n  REMINDER DESK');
    console.log(`  ${url}`);
    console.log('  Keep this window open. Press Ctrl+C to stop.\n');
    openBrowser(url);
    app.scheduler.checkNow().catch(error => console.error(error));
  });

  const shutdown = () => {
    console.log('\nStopping Reminder Desk...');
    app.scheduler.stop();
    app.server.close(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Could not start Reminder Desk: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { createAppServer, serveStatic, openBrowser, prepareNotificationIdentity };
