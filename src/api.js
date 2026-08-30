const { createReminder, applyReminderPatch } = require('./reminders');

const BODY_LIMIT = 64 * 1024;

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size <= BODY_LIMIT) chunks.push(chunk);
  }
  if (size > BODY_LIMIT) {
    const error = new RangeError('Request body is too large');
    error.statusCode = 413;
    throw error;
  }

  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new SyntaxError('Request body must contain valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Request body must be a JSON object');
  }
  return value;
}

function createApiHandler({ store, now = Date.now }) {
  return async function apiHandler(request, response) {
    const url = new URL(request.url, 'http://localhost');
    const collectionRoute = url.pathname === '/api/reminders';
    const itemMatch = url.pathname.match(/^\/api\/reminders\/([^/]+)$/);

    try {
      if (collectionRoute && request.method === 'GET') {
        return sendJson(response, 200, store.list());
      }

      if (collectionRoute && request.method === 'POST') {
        const reminder = createReminder(await readJson(request), now());
        await store.upsert(reminder);
        return sendJson(response, 201, reminder);
      }

      if (itemMatch && request.method === 'PATCH') {
        const id = decodeURIComponent(itemMatch[1]);
        const existing = store.list().find(reminder => reminder.id === id);
        if (!existing) return sendJson(response, 404, { error: 'Reminder not found' });
        const reminder = applyReminderPatch(existing, await readJson(request), now());
        await store.upsert(reminder);
        return sendJson(response, 200, reminder);
      }

      if (itemMatch && request.method === 'DELETE') {
        const removed = await store.remove(decodeURIComponent(itemMatch[1]));
        if (!removed) return sendJson(response, 404, { error: 'Reminder not found' });
        response.writeHead(204);
        return response.end();
      }

      return sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
      const status = error.statusCode
        || (error instanceof TypeError || error instanceof RangeError || error instanceof SyntaxError ? 400 : 500);
      const message = status === 500 ? 'Internal server error' : error.message;
      if (status === 500) console.error(error);
      return sendJson(response, status, { error: message });
    }
  };
}

module.exports = { createApiHandler, readJson };
