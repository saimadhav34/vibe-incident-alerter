// Popup UI Controller for Vibe On-Call Email Alerter (Chrome & Edge)

const DEFAULT_KEYWORDS = [
  'vibe on call',
  'you are being paged',
  'cibranium labs'
];

const DEFAULT_SETTINGS = {
  enabled: true,
  monitoredEmail: '',
  mailProvider: 'auto',
  keywords: DEFAULT_KEYWORDS,
  matchMode: 'smart',
  senderFilter: '',
  unreadOnly: true,
  alertOnExistingUnread: true,
  loopSound: true,
  soundType: 'siren',
  volume: 0.9,
  desktopNotification: true,
  inPageBanner: true
};

let settingsState = { ...DEFAULT_SETTINGS };

const elements = {
  enabledToggle: document.getElementById('enabledToggle'),
  activeAlarmPanel: document.getElementById('activeAlarmPanel'),
  activeAlarmSubject: document.getElementById('activeAlarmSubject'),
  activeAlarmSender: document.getElementById('activeAlarmSender'),
  ackAlarmBtn: document.getElementById('ackAlarmBtn'),
  openMailTabBtn: document.getElementById('openMailTabBtn'),
  connectionBadge: document.getElementById('connectionBadge'),
  monitoredEmailInput: document.getElementById('monitoredEmailInput'),
  mailProviderSelect: document.getElementById('mailProviderSelect'),
  connectMailboxBtn: document.getElementById('connectMailboxBtn'),
  connectionSubtext: document.getElementById('connectionSubtext'),
  resetKeywordsBtn: document.getElementById('resetKeywordsBtn'),
  keywordInput: document.getElementById('keywordInput'),
  addKeywordBtn: document.getElementById('addKeywordBtn'),
  keywordsList: document.getElementById('keywordsList'),
  matchModeSelect: document.getElementById('matchModeSelect'),
  senderFilterInput: document.getElementById('senderFilterInput'),
  unreadOnlyCheckbox: document.getElementById('unreadOnlyCheckbox'),
  alertExistingCheckbox: document.getElementById('alertExistingCheckbox'),
  soundTypeSelect: document.getElementById('soundTypeSelect'),
  previewSoundBtn: document.getElementById('previewSoundBtn'),
  volumeSlider: document.getElementById('volumeSlider'),
  volumeValueLabel: document.getElementById('volumeValueLabel'),
  loopSoundCheckbox: document.getElementById('loopSoundCheckbox'),
  desktopNotifCheckbox: document.getElementById('desktopNotifCheckbox'),
  inPageBannerCheckbox: document.getElementById('inPageBannerCheckbox'),
  simulateIncidentBtn: document.getElementById('simulateIncidentBtn'),
  clearHistoryBtn: document.getElementById('clearHistoryBtn'),
  historyContainer: document.getElementById('historyContainer'),
  statusIndicator: document.getElementById('statusIndicator')
};

async function saveSettings(partial) {
  settingsState = { ...settingsState, ...partial };
  try {
    await chrome.storage.local.set({ settings: settingsState });
    updateStatusFooter();
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

function updateStatusFooter() {
  if (!elements.statusIndicator) return;
  const emailInfo = settingsState.monitoredEmail
    ? ` (${settingsState.monitoredEmail})`
    : '';
  if (settingsState.enabled) {
    elements.statusIndicator.textContent = `🟢 Monitoring active${emailInfo}`;
  } else {
    elements.statusIndicator.textContent = '⚪ Monitoring paused — toggle switch above to enable';
  }
}

async function refreshConnectionStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ type: 'GET_CONNECTION_STATUS' });
    if (!status) return;

    if (status.connected) {
      elements.connectionBadge.className = 'conn-badge conn-badge-ok';
      elements.connectionBadge.textContent = `🟢 Connected (${status.openTabCount} tab${status.openTabCount > 1 ? 's' : ''})`;
      const acct = status.detectedAccountEmail || status.monitoredEmail;
      elements.connectionSubtext.textContent = acct
        ? `Actively watching inbox for ${acct}.`
        : `Actively watching open mail tab: "${(status.activeTabTitle || 'Webmail').slice(0, 48)}"`;
    } else {
      elements.connectionBadge.className = 'conn-badge conn-badge-warn';
      elements.connectionBadge.textContent = '🟠 No Mail Tab Open';
      elements.connectionSubtext.textContent =
        'Enter your email above and click "Attach & Open Mail" to keep your inbox monitored.';
    }
  } catch (err) {
    console.warn('Could not refresh connection status:', err);
  }
}

function renderKeywordChips() {
  elements.keywordsList.textContent = '';
  const keywords = Array.isArray(settingsState.keywords) ? settingsState.keywords : [];

  if (keywords.length === 0) {
    const emptyMsg = document.createElement('span');
    emptyMsg.className = 'muted';
    emptyMsg.textContent = 'No keywords added — click "Restore Vibe Preset" above.';
    elements.keywordsList.appendChild(emptyMsg);
    return;
  }

  for (const kw of keywords) {
    const chip = document.createElement('span');
    chip.className = 'keyword-chip';

    const label = document.createElement('span');
    label.textContent = kw;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'keyword-chip-remove';
    removeBtn.title = `Remove "${kw}"`;
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', async () => {
      const updated = settingsState.keywords.filter((item) => item !== kw);
      await saveSettings({ keywords: updated });
      renderKeywordChips();
    });

    chip.appendChild(label);
    chip.appendChild(removeBtn);
    elements.keywordsList.appendChild(chip);
  }
}

async function addKeywordFromInput() {
  const raw = (elements.keywordInput.value || '').trim().toLowerCase();
  if (!raw) return;

  const newTokens = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !settingsState.keywords.includes(t));

  if (newTokens.length > 0) {
    await saveSettings({ keywords: [...settingsState.keywords, ...newTokens] });
    renderKeywordChips();
  }
  elements.keywordInput.value = '';
}

function renderActiveAlarmPanel(alarmState) {
  if (alarmState && alarmState.active && alarmState.incident) {
    elements.activeAlarmPanel.classList.remove('hidden');
    elements.activeAlarmSubject.textContent = alarmState.incident.subject || '(No Subject)';
    elements.activeAlarmSender.textContent = `From: ${alarmState.incident.sender || 'Vibe On Call'} (${alarmState.incident.provider || 'Webmail'})`;
  } else {
    elements.activeAlarmPanel.classList.add('hidden');
  }
}

function formatTimeShort(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (_e) {
    return '';
  }
}

function renderHistory(history) {
  elements.historyContainer.textContent = '';
  if (!Array.isArray(history) || history.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = 'No Vibe On-Call pages triggered yet.';
    elements.historyContainer.appendChild(empty);
    return;
  }

  for (const item of history.slice(0, 8)) {
    const row = document.createElement('div');
    row.className = 'history-item';

    const top = document.createElement('div');
    top.className = 'history-item-top';

    const provider = document.createElement('span');
    provider.className = 'history-provider';
    provider.textContent = `${item.provider || 'Mail'}${item.isTest ? ' • TEST' : ''}`;

    const time = document.createElement('span');
    time.className = 'history-time';
    time.textContent = formatTimeShort(item.detectedAt);

    top.appendChild(provider);
    top.appendChild(time);

    const subject = document.createElement('p');
    subject.className = 'history-subject';
    subject.textContent = item.subject || '(No Subject)';

    const sender = document.createElement('p');
    sender.className = 'history-sender';
    sender.textContent = `From: ${item.sender || 'Vibe On Call'}`;

    row.appendChild(top);
    row.appendChild(subject);
    row.appendChild(sender);
    elements.historyContainer.appendChild(row);
  }
}

function populateFormFromSettings() {
  elements.enabledToggle.checked = settingsState.enabled !== false;
  elements.monitoredEmailInput.value = settingsState.monitoredEmail || '';
  elements.mailProviderSelect.value = settingsState.mailProvider || 'auto';
  elements.matchModeSelect.value = settingsState.matchMode || 'smart';
  elements.senderFilterInput.value = settingsState.senderFilter || '';
  elements.unreadOnlyCheckbox.checked = settingsState.unreadOnly !== false;
  elements.alertExistingCheckbox.checked = settingsState.alertOnExistingUnread !== false;
  elements.soundTypeSelect.value = settingsState.soundType || 'siren';

  const volPercent = Math.round((settingsState.volume ?? 0.9) * 100);
  elements.volumeSlider.value = String(volPercent);
  elements.volumeValueLabel.textContent = `${volPercent}%`;

  elements.loopSoundCheckbox.checked = settingsState.loopSound !== false;
  elements.desktopNotifCheckbox.checked = settingsState.desktopNotification !== false;
  elements.inPageBannerCheckbox.checked = settingsState.inPageBanner !== false;

  renderKeywordChips();
  updateStatusFooter();
}

function bindEvents() {
  elements.enabledToggle.addEventListener('change', async (e) => {
    await saveSettings({ enabled: e.target.checked });
  });

  elements.monitoredEmailInput.addEventListener('input', async (e) => {
    await saveSettings({ monitoredEmail: e.target.value.trim() });
  });

  elements.mailProviderSelect.addEventListener('change', async (e) => {
    await saveSettings({ mailProvider: e.target.value });
  });

  elements.connectMailboxBtn.addEventListener('click', async () => {
    const email = (elements.monitoredEmailInput.value || '').trim();
    const provider = elements.mailProviderSelect.value || 'auto';
    await saveSettings({ monitoredEmail: email, mailProvider: provider });
    try {
      await chrome.runtime.sendMessage({
        type: 'CONNECT_MAILBOX',
        email,
        provider
      });
      await refreshConnectionStatus();
    } catch (err) {
      console.error('Error connecting mailbox:', err);
    }
  });

  elements.addKeywordBtn.addEventListener('click', async () => {
    await addKeywordFromInput();
  });

  elements.keywordInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await addKeywordFromInput();
    }
  });

  elements.resetKeywordsBtn.addEventListener('click', async () => {
    await saveSettings({
      keywords: [...DEFAULT_KEYWORDS],
      matchMode: 'smart'
    });
    elements.matchModeSelect.value = 'smart';
    renderKeywordChips();
  });

  elements.matchModeSelect.addEventListener('change', async (e) => {
    await saveSettings({ matchMode: e.target.value });
  });

  elements.senderFilterInput.addEventListener('input', async (e) => {
    await saveSettings({ senderFilter: e.target.value });
  });

  elements.unreadOnlyCheckbox.addEventListener('change', async (e) => {
    await saveSettings({ unreadOnly: e.target.checked });
  });

  elements.alertExistingCheckbox.addEventListener('change', async (e) => {
    await saveSettings({ alertOnExistingUnread: e.target.checked });
  });

  elements.soundTypeSelect.addEventListener('change', async (e) => {
    await saveSettings({ soundType: e.target.value });
  });

  elements.volumeSlider.addEventListener('input', async (e) => {
    const pct = Number(e.target.value) || 90;
    elements.volumeValueLabel.textContent = `${pct}%`;
    await saveSettings({ volume: pct / 100 });
  });

  elements.loopSoundCheckbox.addEventListener('change', async (e) => {
    await saveSettings({ loopSound: e.target.checked });
  });

  elements.desktopNotifCheckbox.addEventListener('change', async (e) => {
    await saveSettings({ desktopNotification: e.target.checked });
  });

  elements.inPageBannerCheckbox.addEventListener('change', async (e) => {
    await saveSettings({ inPageBanner: e.target.checked });
  });

  elements.previewSoundBtn.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({
        type: 'PREVIEW_SOUND',
        soundType: settingsState.soundType || 'siren',
        volume: settingsState.volume ?? 0.9
      });
    } catch (err) {
      console.error('Preview sound failed:', err);
    }
  });

  elements.ackAlarmBtn.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'ACKNOWLEDGE_ALARM' });
    } catch (err) {
      console.error('Error acknowledging alarm:', err);
    }
  });

  elements.openMailTabBtn.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'FOCUS_MAIL_TAB' });
    } catch (err) {
      console.error('Error focusing mail tab:', err);
    }
  });

  elements.simulateIncidentBtn.addEventListener('click', async () => {
    try {
      const kws =
        Array.isArray(settingsState.keywords) && settingsState.keywords.length > 0
          ? settingsState.keywords
          : DEFAULT_KEYWORDS;
      await chrome.runtime.sendMessage({
        type: 'INCIDENT_DETECTED',
        payload: {
          id: `test-incident-${Date.now()}`,
          subject: 'Vibe On Call: You are being paged — Cibranium Labs',
          sender: 'Vibe On Call <notifications@cibraniumlabs.com>',
          snippet: 'From Vibe On Call: You are being paged for an incident at Cibranium Labs.',
          provider: 'Simulation',
          accountEmail: settingsState.monitoredEmail || '',
          matchedKeywords: kws,
          isTest: true
        }
      });
    } catch (err) {
      console.error('Error simulating incident:', err);
    }
  });

  elements.clearHistoryBtn.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY', resetSeen: true });
      renderHistory([]);
    } catch (err) {
      console.error('Error clearing history:', err);
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const stored = await chrome.storage.local.get([
      'settings',
      'alarmState',
      'incidentHistory'
    ]);

    if (stored.settings) {
      settingsState = { ...DEFAULT_SETTINGS, ...stored.settings };
      if (
        Array.isArray(settingsState.keywords) &&
        settingsState.keywords.length === 2 &&
        settingsState.keywords[0] === 'vibe' &&
        settingsState.keywords[1] === 'incident'
      ) {
        settingsState.keywords = [...DEFAULT_KEYWORDS];
        settingsState.matchMode = 'smart';
        await chrome.storage.local.set({ settings: settingsState });
      }
    }

    populateFormFromSettings();
    renderActiveAlarmPanel(stored.alarmState || { active: false });
    renderHistory(stored.incidentHistory || []);
    bindEvents();
    await refreshConnectionStatus();
  } catch (err) {
    console.error('Failed to initialize popup:', err);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes.alarmState) {
    renderActiveAlarmPanel(changes.alarmState.newValue);
  }
  if (changes.incidentHistory) {
    renderHistory(changes.incidentHistory.newValue || []);
  }
  if (changes.detectedAccountEmail) {
    refreshConnectionStatus();
  }
});
