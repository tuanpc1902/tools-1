const http = require('node:http');

function parseConfirmationUri(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new RangeError('Confirmation URI is invalid');
  }
  if (url.protocol !== 'reminderdesk:' || url.hostname !== 'confirm') {
    throw new RangeError('Confirmation URI must use the reminderdesk protocol');
  }

  const id = decodeURIComponent(url.pathname.slice(1));
  if (!id) throw new RangeError('Confirmation URI is missing a reminder id');

  const rawPort = url.searchParams.get('port');
  const port = rawPort === null ? 4317 : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError('Confirmation URI port is invalid');
  }
  return { id, port };
}

function confirmViaLocalServer({ id, port, request = http.request }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };

    let client;
    try {
      client = request(
        {
          hostname: '127.0.0.1',
          port,
          path: `/api/reminders/${encodeURIComponent(id)}/confirm`,
          method: 'POST',
          headers: { 'content-type': 'application/json', 'content-length': '2' },
        },
        response => {
          response.resume?.();
          response.once('end', () => {
            if (response.statusCode >= 200 && response.statusCode < 300) finish();
            else finish(new Error(`Reminder confirmation failed (HTTP ${response.statusCode})`));
          });
        },
      );
      client.once('error', error => finish(error));
      client.end('{}');
    } catch (error) {
      finish(error);
    }
  });
}

async function main() {
  const parsed = parseConfirmationUri(process.argv[2]);
  await confirmViaLocalServer(parsed);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Could not confirm reminder: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseConfirmationUri, confirmViaLocalServer };
