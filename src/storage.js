const { mkdir, readFile, writeFile, rename } = require('node:fs/promises');
const path = require('node:path');

function cloneReminders(reminders) {
  return reminders.map(reminder => ({ ...reminder }));
}

function createStore(filePath, { onWarning = console.warn } = {}) {
  let reminders = [];
  let writeChain = Promise.resolve();

  async function persist(snapshot) {
    const directory = path.dirname(filePath);
    const temporaryPath = `${filePath}.tmp`;
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, filePath);
  }

  function queuePersist() {
    const snapshot = cloneReminders(reminders);
    writeChain = writeChain.then(() => persist(snapshot));
    return writeChain;
  }

  async function load() {
    try {
      const content = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) throw new TypeError('Stored reminders must be an array');
      reminders = cloneReminders(parsed);
    } catch (error) {
      if (error.code === 'ENOENT') {
        reminders = [];
      } else {
        const extension = path.extname(filePath);
        const baseName = path.basename(filePath, extension);
        const backupPath = path.join(
          path.dirname(filePath),
          `${baseName}.corrupt-${Date.now()}${extension}`,
        );
        await rename(filePath, backupPath);
        reminders = [];
        onWarning(`Malformed reminder data was backed up to ${backupPath}`);
      }
    }
    return cloneReminders(reminders);
  }

  function list() {
    return cloneReminders(reminders);
  }

  async function replaceAll(nextReminders) {
    reminders = cloneReminders(nextReminders);
    await queuePersist();
    return list();
  }

  async function upsert(reminder) {
    const index = reminders.findIndex(item => item.id === reminder.id);
    if (index === -1) reminders.push({ ...reminder });
    else reminders[index] = { ...reminder };
    await queuePersist();
    return { ...reminder };
  }

  async function remove(id) {
    const originalLength = reminders.length;
    reminders = reminders.filter(reminder => reminder.id !== id);
    if (reminders.length !== originalLength) await queuePersist();
    return reminders.length !== originalLength;
  }

  return { load, list, replaceAll, upsert, remove };
}

module.exports = { createStore };
