const { randomUUID } = require('node:crypto');

function cleanText(value, field, required = false) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string') throw new TypeError(`${field} must be text`);
  const result = value.trim();
  if (required && !result) throw new RangeError('Reminder title is required');
  return result;
}

function resolveTrigger(input, now) {
  if (input.mode === 'datetime') {
    const triggerAt = Number(input.triggerAt);
    if (!Number.isFinite(triggerAt) || triggerAt <= now) {
      throw new RangeError('Date and time must be in the future');
    }
    return triggerAt;
  }

  if (input.mode === 'countdown') {
    const durationSeconds = Number(input.durationSeconds);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new RangeError('Countdown duration must be positive');
    }
    return now + Math.round(durationSeconds * 1_000);
  }

  throw new RangeError('Mode must be datetime or countdown');
}

function getNextDailyTrigger(dailyTime, now = Date.now()) {
  if (typeof dailyTime !== 'string' || !/^\d{2}:\d{2}$/.test(dailyTime)) {
    throw new RangeError('Daily time must use HH:MM format');
  }
  const [hour, minute] = dailyTime.split(':').map(Number);
  if (hour > 23 || minute > 59) {
    throw new RangeError('Daily time must use HH:MM format');
  }

  const current = new Date(now);
  const next = new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate(),
    hour,
    minute,
    0,
    0,
  );
  if (next.getTime() <= now) next.setDate(next.getDate() + 1);
  return next.getTime();
}

function normalizeRepeat(input, now) {
  const repeatType = input.repeatType ?? 'none';

  if (repeatType === 'interval') {
    const repeatIntervalSeconds = Number(input.repeatIntervalSeconds);
    if (!Number.isFinite(repeatIntervalSeconds) || repeatIntervalSeconds <= 0) {
      throw new RangeError('Repeat interval must be positive');
    }
    return {
      repeatType,
      repeatIntervalSeconds,
      dailyTime: null,
      mode: 'countdown',
      triggerAt: now + Math.round(repeatIntervalSeconds * 1_000),
    };
  }

  if (repeatType === 'daily') {
    const dailyTime = input.dailyTime;
    return {
      repeatType,
      repeatIntervalSeconds: null,
      dailyTime,
      mode: 'datetime',
      triggerAt: getNextDailyTrigger(dailyTime, now),
    };
  }

  if (repeatType !== 'none') {
    throw new RangeError('Repeat type must be none, interval, or daily');
  }

  return {
    repeatType: 'none',
    repeatIntervalSeconds: null,
    dailyTime: null,
    mode: input.mode,
    triggerAt: resolveTrigger(input, now),
  };
}

function createReminder(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Reminder input must be an object');
  }

  const title = cleanText(input.title, 'Title', true);
  const message = cleanText(input.message ?? '', 'Message');
  const schedule = normalizeRepeat(input, now);
  return {
    id: randomUUID(),
    title,
    message,
    ...schedule,
    status: 'active',
    createdAt: now,
    firedAt: null,
  };
}

function applyReminderPatch(existing, patch, now = Date.now()) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new TypeError('Reminder patch must be an object');
  }

  const next = { ...existing };

  if (patch.title !== undefined) next.title = cleanText(patch.title, 'Title', true);
  if (patch.message !== undefined) next.message = cleanText(patch.message, 'Message');

  const reschedules = patch.repeatType !== undefined
    || patch.repeatIntervalSeconds !== undefined
    || patch.dailyTime !== undefined
    || patch.mode !== undefined
    || patch.triggerAt !== undefined
    || patch.durationSeconds !== undefined;

  if (reschedules) {
    const repeatType = patch.repeatType ?? existing.repeatType ?? 'none';
    const schedule = normalizeRepeat({ ...existing, ...patch, repeatType }, now);
    Object.assign(next, schedule);
    next.status = 'active';
    next.firedAt = null;
  }

  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') throw new TypeError('Enabled must be true or false');
    if (next.status === 'fired' && patch.enabled) {
      throw new RangeError('A completed reminder must be rescheduled before enabling');
    }
    if (next.status !== 'fired') next.status = patch.enabled ? 'active' : 'disabled';
  }

  return next;
}

function getDueReminders(reminders, now = Date.now()) {
  return reminders.filter(reminder => reminder.status === 'active' && reminder.triggerAt <= now);
}

function markFired(reminder, now = Date.now()) {
  return { ...reminder, status: 'fired', firedAt: now };
}

function advanceAfterDue(reminder, now = Date.now()) {
  const repeatType = reminder.repeatType ?? 'none';
  if (repeatType === 'none') return markFired(reminder, now);

  if (repeatType === 'interval') {
    const intervalMs = Number(reminder.repeatIntervalSeconds) * 1_000;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new RangeError('Repeat interval must be positive');
    }
    const steps = Math.floor((now - reminder.triggerAt) / intervalMs) + 1;
    return {
      ...reminder,
      status: 'active',
      triggerAt: reminder.triggerAt + Math.max(1, steps) * intervalMs,
      firedAt: now,
    };
  }

  if (repeatType === 'daily') {
    return {
      ...reminder,
      status: 'active',
      triggerAt: getNextDailyTrigger(reminder.dailyTime, now),
      firedAt: now,
    };
  }

  throw new RangeError('Repeat type must be none, interval, or daily');
}

module.exports = {
  createReminder,
  applyReminderPatch,
  getDueReminders,
  markFired,
  getNextDailyTrigger,
  advanceAfterDue,
};
