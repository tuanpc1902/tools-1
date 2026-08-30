const { getDueReminders, advanceAfterDue } = require('./reminders');

function createScheduler({
  store,
  deliver,
  now = Date.now,
  intervalMs = 1_000,
  onError = error => console.error('Reminder delivery failed:', error),
}) {
  let checking = false;

  async function checkNow() {
    if (checking) return;
    checking = true;
    try {
      const checkedAt = now();
      const current = store.list();
      const due = getDueReminders(current, checkedAt);
      if (due.length === 0) return;

      const dueIds = new Set(due.map(reminder => reminder.id));
      const advancedById = new Map();
      const next = current.map(reminder => {
        if (!dueIds.has(reminder.id)) return reminder;
        const advanced = advanceAfterDue(reminder, checkedAt);
        advancedById.set(advanced.id, advanced);
        return advanced;
      });

      await store.replaceAll(next);

      for (const reminder of due) {
        try {
          await deliver(reminder);
        } catch (error) {
          onError(error, advancedById.get(reminder.id));
        }
      }
    } finally {
      checking = false;
    }
  }

  const timer = setInterval(() => {
    checkNow().catch(onError);
  }, intervalMs);
  timer.unref?.();

  return {
    checkNow,
    stop() {
      clearInterval(timer);
    },
  };
}

module.exports = { createScheduler };
