(function reminderDesk() {
  'use strict';

  function parseWholePositive(value, label) {
    const number = Number(value || 0);
    if (!Number.isInteger(number) || number < 0) {
      throw new RangeError(`${label} must be a whole positive number`);
    }
    return number;
  }

  function getCountdownSeconds({ hours, minutes, seconds }) {
    const total = parseWholePositive(hours, 'Hours') * 3600
      + parseWholePositive(minutes, 'Minutes') * 60
      + parseWholePositive(seconds, 'Seconds');
    if (total <= 0) throw new RangeError('Countdown must be greater than zero');
    return total;
  }

  function getDateTimeTimestamp(value, now = Date.now()) {
    if (!value) throw new RangeError('Choose a date and time');
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp) || timestamp <= now) {
      throw new RangeError('Date and time must be in the future');
    }
    return timestamp;
  }

  function formatRemaining(milliseconds) {
    if (milliseconds <= 0) return 'Due now';
    const total = Math.ceil(milliseconds / 1_000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }

  function getTimingTone(milliseconds) {
    if (milliseconds <= 0) return 'due';
    if (milliseconds <= 300_000) return 'soon';
    return 'scheduled';
  }

  function normalizeViewMode(value) {
    return ['aurora', 'focus', 'daylight'].includes(value) ? value : 'aurora';
  }

  function getNextViewMode(current) {
    const mode = normalizeViewMode(current);
    if (mode === 'aurora') return 'focus';
    if (mode === 'focus') return 'daylight';
    return 'aurora';
  }

  function getConfirmationPath(reminder) {
    return `/api/reminders/${encodeURIComponent(reminder.id)}/confirm`;
  }

  function getStatusLabel(reminder) {
    return reminder.status === 'awaiting_confirmation' ? 'Awaiting confirmation' : '';
  }

  function groupReminders(reminders) {
    const active = reminders
      .filter(reminder => reminder.status !== 'fired')
      .sort((a, b) => a.triggerAt - b.triggerAt);
    const completed = reminders
      .filter(reminder => reminder.status === 'fired')
      .sort((a, b) => b.firedAt - a.firedAt);
    return { active, completed };
  }

  function getRepeatPayload({ repeatType, hours, minutes, seconds, dailyTime }) {
    if (repeatType === 'interval') {
      return {
        repeatType: 'interval',
        repeatIntervalSeconds: getCountdownSeconds({ hours, minutes, seconds }),
      };
    }
    if (repeatType === 'daily') {
      if (typeof dailyTime !== 'string' || !/^\d{2}:\d{2}$/.test(dailyTime)) {
        throw new RangeError('Choose a valid daily time');
      }
      const [hour, minute] = dailyTime.split(':').map(Number);
      if (hour > 23 || minute > 59) throw new RangeError('Choose a valid daily time');
      return { repeatType: 'daily', dailyTime };
    }
    return { repeatType: 'none' };
  }

  function formatInterval(seconds) {
    const parts = [];
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    if (hours) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
    if (minutes) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
    if (remainingSeconds) parts.push(`${remainingSeconds} ${remainingSeconds === 1 ? 'second' : 'seconds'}`);
    return parts.join(' ') || '0 seconds';
  }

  function getRepeatLabel(reminder) {
    if (reminder.repeatType === 'interval') return `Every ${formatInterval(reminder.repeatIntervalSeconds)}`;
    if (reminder.repeatType === 'daily') return `Daily at ${reminder.dailyTime}`;
    return 'One time';
  }

  const exported = {
    getCountdownSeconds,
    getDateTimeTimestamp,
    formatRemaining,
    groupReminders,
    getRepeatPayload,
    getRepeatLabel,
    getTimingTone,
    normalizeViewMode,
    getNextViewMode,
    getConfirmationPath,
    getStatusLabel,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  if (typeof document === 'undefined') return;

  const elements = {
    form: document.querySelector('#reminder-form'),
    id: document.querySelector('#reminder-id'),
    title: document.querySelector('#title'),
    message: document.querySelector('#message'),
    hours: document.querySelector('#hours'),
    minutes: document.querySelector('#minutes'),
    seconds: document.querySelector('#seconds'),
    triggerAt: document.querySelector('#trigger-at'),
    dailyTime: document.querySelector('#daily-time'),
    dailyTimeField: document.querySelector('#daily-time-field'),
    oneTimeMode: document.querySelector('#one-time-mode'),
    countdownFields: document.querySelector('#countdown-fields'),
    datetimeField: document.querySelector('#datetime-field'),
    status: document.querySelector('#form-status'),
    submitLabel: document.querySelector('#submit-label'),
    cancelEdit: document.querySelector('#cancel-edit'),
    activeList: document.querySelector('#active-list'),
    completedList: document.querySelector('#completed-list'),
    activeCount: document.querySelector('#active-count'),
    completedCount: document.querySelector('#completed-count'),
    currentDate: document.querySelector('#current-date'),
    currentTime: document.querySelector('#current-time'),
    viewToggle: document.querySelector('#view-toggle'),
    viewModeLabel: document.querySelector('#view-mode-label'),
    viewModeGlyph: document.querySelector('#view-mode-glyph'),
  };

  let reminders = [];

  function loadViewMode() {
    try {
      return normalizeViewMode(window.localStorage.getItem('reminder-desk-view-mode'));
    } catch {
      return 'aurora';
    }
  }

  function setViewMode(mode, persist = true) {
    const nextMode = normalizeViewMode(mode);
    document.body.dataset.viewMode = nextMode;
    elements.viewToggle.setAttribute('aria-pressed', String(nextMode !== 'aurora'));
    const nextLabel = nextMode === 'aurora' ? 'Focus list' : nextMode === 'focus' ? 'Daylight' : 'Aurora';
    elements.viewToggle.setAttribute('aria-label', `Switch to ${nextLabel} view`);
    elements.viewModeLabel.textContent = nextLabel;
    elements.viewModeGlyph.textContent = nextMode === 'focus' ? '◒' : nextMode === 'daylight' ? '☼' : '◐';
    if (persist) {
      try {
        window.localStorage.setItem('reminder-desk-view-mode', nextMode);
      } catch {
        // Private browsing or disabled storage should not block the toggle.
      }
    }
  }

  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: options.body ? { 'content-type': 'application/json', ...options.headers } : options.headers,
    });
    if (response.status === 204) return null;
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'The request failed');
    return body;
  }

  function currentMode() {
    return document.querySelector('input[name="mode"]:checked').value;
  }

  function currentRepeatType() {
    return document.querySelector('input[name="repeat-type"]:checked').value;
  }

  function updateScheduleFields() {
    const repeatType = currentRepeatType();
    const mode = currentMode();
    elements.oneTimeMode.hidden = repeatType !== 'none';
    elements.countdownFields.hidden = repeatType === 'daily' || (repeatType === 'none' && mode !== 'countdown');
    elements.datetimeField.hidden = repeatType !== 'none' || mode !== 'datetime';
    elements.dailyTimeField.hidden = repeatType !== 'daily';
  }

  function setMode(mode) {
    document.querySelector(`input[name="mode"][value="${mode}"]`).checked = true;
    updateScheduleFields();
  }

  function setRepeatType(repeatType) {
    document.querySelector(`input[name="repeat-type"][value="${repeatType}"]`).checked = true;
    updateScheduleFields();
  }

  function toLocalInput(timestamp) {
    const date = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000);
    return date.toISOString().slice(0, 16);
  }

  function resetForm(message = '') {
    elements.form.reset();
    elements.id.value = '';
    elements.minutes.value = '5';
    elements.submitLabel.textContent = 'Set reminder';
    elements.cancelEdit.hidden = true;
    setRepeatType('none');
    setMode('countdown');
    elements.status.textContent = message;
    elements.status.classList.toggle('success', Boolean(message));
  }

  function makeButton(label, action, reminder) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => action(reminder));
    return button;
  }

  function createCard(reminder, index) {
    const card = document.createElement('article');
    card.className = `reminder-card ${reminder.status}`;
    if (reminder.status === 'active') {
      card.classList.add(`timing-${getTimingTone(reminder.triggerAt - Date.now())}`);
    }
    card.style.animationDelay = `${Math.min(index * 45, 250)}ms`;

    const body = document.createElement('div');
    const kicker = document.createElement('div');
    kicker.className = 'card-kicker';
    const kind = document.createElement('span');
    kind.textContent = getRepeatLabel(reminder);
    kicker.append(kind);
    const statusLabel = getStatusLabel(reminder);
    if (statusLabel) {
      const waiting = document.createElement('span');
      waiting.className = 'waiting-label';
      waiting.textContent = statusLabel;
      kicker.append(waiting);
    }
    if (reminder.status === 'disabled') {
      const off = document.createElement('span');
      off.className = 'disabled-label';
      off.textContent = 'Paused';
      kicker.append(off);
    }
    const title = document.createElement('h3');
    title.textContent = reminder.title;
    const message = document.createElement('p');
    message.textContent = reminder.message || 'No note attached.';
    body.append(kicker, title, message);

    const timing = document.createElement('div');
    timing.className = 'time-left';
    timing.dataset.triggerAt = reminder.triggerAt;
    timing.textContent = reminder.status === 'fired'
      ? 'Completed'
      : reminder.status === 'awaiting_confirmation'
        ? 'Confirm to continue'
        : formatRemaining(reminder.triggerAt - Date.now());
    const date = document.createElement('span');
    date.className = 'trigger-date';
    date.textContent = new Date(reminder.triggerAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    timing.append(date);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    if (reminder.status === 'awaiting_confirmation') {
      actions.append(makeButton('Confirm', confirmReminderFromUi, reminder));
    } else if (reminder.status !== 'fired') {
      actions.append(
        makeButton('Edit', beginEdit, reminder),
        makeButton(reminder.status === 'active' ? 'Pause' : 'Enable', toggleReminder, reminder),
      );
    } else {
      actions.append(makeButton('Schedule again', beginEdit, reminder));
    }
    actions.append(makeButton('Delete', deleteReminder, reminder));
    card.append(body, timing, actions);
    return card;
  }

  function renderReminders(nextReminders = reminders) {
    reminders = nextReminders;
    const groups = groupReminders(reminders);
    elements.activeList.replaceChildren();
    elements.completedList.replaceChildren();

    if (groups.active.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'The desk is clear. Set something worth remembering.';
      elements.activeList.append(empty);
    } else {
      groups.active.forEach((reminder, index) => elements.activeList.append(createCard(reminder, index)));
    }
    groups.completed.forEach((reminder, index) => elements.completedList.append(createCard(reminder, index)));
    elements.activeCount.textContent = `${groups.active.filter(item => item.status === 'active').length} active`;
    elements.completedCount.textContent = String(groups.completed.length);
  }

  async function loadReminders() {
    try {
      renderReminders(await request('/api/reminders'));
    } catch (error) {
      elements.status.textContent = `Could not load reminders: ${error.message}`;
      elements.status.classList.remove('success');
    }
  }

  async function confirmReminderFromUi(reminder) {
    try {
      await request(getConfirmationPath(reminder), { method: 'POST', body: '{}' });
      await loadReminders();
    } catch (error) {
      elements.status.textContent = error.message;
      elements.status.classList.remove('success');
    }
  }

  async function submitReminder(event) {
    event.preventDefault();
    elements.status.textContent = '';
    elements.status.classList.remove('success');
    try {
      if (!elements.title.value.trim()) {
        elements.title.focus();
        throw new Error('Enter a reminder title');
      }
      const repeatType = currentRepeatType();
      const body = {
        title: elements.title.value,
        message: elements.message.value,
        ...getRepeatPayload({
          repeatType,
          hours: elements.hours.value,
          minutes: elements.minutes.value,
          seconds: elements.seconds.value,
          dailyTime: elements.dailyTime.value,
        }),
      };
      if (repeatType === 'none' && currentMode() === 'countdown') {
        body.mode = 'countdown';
        body.durationSeconds = getCountdownSeconds({
          hours: elements.hours.value,
          minutes: elements.minutes.value,
          seconds: elements.seconds.value,
        });
      } else if (repeatType === 'none') {
        body.mode = 'datetime';
        body.triggerAt = getDateTimeTimestamp(elements.triggerAt.value);
      }

      const id = elements.id.value;
      await request(id ? `/api/reminders/${encodeURIComponent(id)}` : '/api/reminders', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      resetForm(id ? 'Reminder updated.' : 'Reminder set. The clock is watching.');
      await loadReminders();
      elements.title.focus();
    } catch (error) {
      elements.status.textContent = error.message;
    }
  }

  function beginEdit(reminder) {
    elements.id.value = reminder.id;
    elements.title.value = reminder.title;
    elements.message.value = reminder.message;
    const repeatType = reminder.repeatType ?? 'none';
    setRepeatType(repeatType);
    setMode(reminder.mode);
    if (repeatType === 'interval') {
      const total = reminder.repeatIntervalSeconds;
      elements.hours.value = Math.floor(total / 3600);
      elements.minutes.value = Math.floor((total % 3600) / 60);
      elements.seconds.value = total % 60;
    } else if (repeatType === 'daily') {
      elements.dailyTime.value = reminder.dailyTime;
    } else if (reminder.mode === 'datetime') {
      elements.triggerAt.value = reminder.triggerAt > Date.now() ? toLocalInput(reminder.triggerAt) : '';
    } else {
      const total = Math.max(60, Math.ceil((reminder.triggerAt - Date.now()) / 1_000));
      elements.hours.value = Math.floor(total / 3600);
      elements.minutes.value = Math.floor((total % 3600) / 60);
      elements.seconds.value = total % 60;
    }
    elements.submitLabel.textContent = reminder.status === 'fired' ? 'Schedule again' : 'Save changes';
    elements.cancelEdit.hidden = false;
    elements.status.textContent = '';
    elements.title.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function toggleReminder(reminder) {
    try {
      await request(`/api/reminders/${encodeURIComponent(reminder.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: reminder.status !== 'active' }),
      });
      await loadReminders();
    } catch (error) {
      elements.status.textContent = error.message;
    }
  }

  async function deleteReminder(reminder) {
    if (!window.confirm(`Delete “${reminder.title}”?`)) return;
    try {
      await request(`/api/reminders/${encodeURIComponent(reminder.id)}`, { method: 'DELETE' });
      if (elements.id.value === reminder.id) resetForm();
      await loadReminders();
    } catch (error) {
      elements.status.textContent = error.message;
    }
  }

  function tick() {
    const now = Date.now();
    elements.currentDate.textContent = new Date(now).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    elements.currentTime.textContent = new Date(now).toLocaleTimeString([], { hour12: false });
    document.querySelectorAll('.time-left[data-trigger-at]').forEach(node => {
      const date = node.querySelector('.trigger-date');
      const card = node.closest('.reminder-card');
      if (card.classList.contains('completed') || card.classList.contains('awaiting_confirmation')) return;
      const remaining = Number(node.dataset.triggerAt) - now;
      node.firstChild.textContent = formatRemaining(remaining);
      if (card.classList.contains('active')) {
        card.classList.remove('timing-due', 'timing-soon', 'timing-scheduled');
        card.classList.add(`timing-${getTimingTone(remaining)}`);
      }
      if (date && date.previousSibling !== node.firstChild) node.prepend(node.firstChild);
    });
  }

  elements.form.addEventListener('submit', submitReminder);
  setViewMode(loadViewMode(), false);
  elements.viewToggle.addEventListener('click', () => setViewMode(getNextViewMode(document.body.dataset.viewMode)));
  elements.cancelEdit.addEventListener('click', () => resetForm());
  document.querySelectorAll('input[name="mode"]').forEach(input => {
    input.addEventListener('change', updateScheduleFields);
  });
  document.querySelectorAll('input[name="repeat-type"]').forEach(input => {
    input.addEventListener('change', updateScheduleFields);
  });
  setInterval(tick, 1_000);
  setInterval(loadReminders, 5_000);
  tick();
  loadReminders();
})();
