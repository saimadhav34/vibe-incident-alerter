// Background Service Worker for Vibe Incident Email Alerter (Manifest V3 - Chrome & Edge)
// Strictly stateless in memory — all state is persisted in chrome.storage.local / chrome.storage.session.

const DEFAULT_KEYWORDS = [
  'vibe on call',
  'you are being paged',
  'cibranium labs'
];

const DEFAULT_SETTINGS = {
  enabled: true,
  monitoredEmail: '',
  mailProvider: 'auto', // 'auto' | 'outlook' | 'gmail'
  keywords: DEFAULT_KEYWORDS,
  matchMode: 'smart', // 'smart' | 'all' | 'any'
  senderFilter: '',
  unreadOnly: true,
  alertOnExistingUnread: true,
  loopSound: true,
  soundType: 'siren', // 'siren' | 'pager' | 'chime' | 'radar'
  volume: 0.9,
  desktopNotification: true,
  inPageBanner: true
};

const DEFAULT_ALARM_STATE = {
  active: false,
  incident: null,
  acknowledgedAt: null
};

const WEBMAIL_URL_PATTERNS = [
  'https://mail.google.com/*',
  'https://outlook.office.com/*',
  'https://outlook.office365.com/*',
  'https://outlook.live.com/*',
  'https://outlook.cloud.microsoft/*'
];

async function initializeDefaults() {
  try {
    const stored = await chrome.storage.local.get([
      'settings',
      'alarmState',
      'incidentHistory',
      'seenEmailIds'
    ]);

    const updates = {};
    if (!stored.settings) {
      updates.settings = DEFAULT_SETTINGS;
    } else {
      const merged = { ...DEFAULT_SETTINGS, ...stored.settings };
      // Upgrade legacy default ['vibe', 'incident'] to the exact Vibe On-Call keywords
      if (
        Array.isArray(merged.keywords) &&
        merged.keywords.length === 2 &&
        merged.keywords[0] === 'vibe' &&
        merged.keywords[1] === 'incident'
      ) {
        merged.keywords = DEFAULT_KEYWORDS;
        merged.matchMode = 'smart';
      }
      updates.settings = merged;
    }

    if (!stored.alarmState) {
      updates.alarmState = DEFAULT_ALARM_STATE;
    }

    if (!Array.isArray(stored.incidentHistory)) {
      updates.incidentHistory = [];
    }

    if (!Array.isArray(stored.seenEmailIds)) {
      updates.seenEmailIds = [];
    }

    await chrome.storage.local.set(updates);
    await syncBadgeWithState(updates.alarmState || stored.alarmState, updates.settings);

    await chrome.alarms.create('vibe-heartbeat-scan', { periodInMinutes: 0.5 });
  } catch (err) {
    console.error('Error initializing defaults:', err);
  }
}

async function syncBadgeWithState(alarmState, settings) {
  try {
    if (alarmState && alarmState.active) {
      await chrome.action.setBadgeText({ text: 'PAGE' });
      await chrome.action.setBadgeBackgroundColor({ color: '#DC2626' });
      return;
    }
    if (settings && settings.enabled === false) {
      await chrome.action.setBadgeText({ text: 'OFF' });
      await chrome.action.setBadgeBackgroundColor({ color: '#6B7280' });
      return;
    }
    await chrome.action.setBadgeText({ text: '' });
  } catch (err) {
    console.error('Error updating badge:', err);
  }
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen || !chrome.offscreen.createDocument) {
    return false;
  }

  const offscreenUrl = chrome.runtime.getURL('offscreen/offscreen.html');

  if (chrome.runtime.getContexts) {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });
    if (existingContexts.length > 0) {
      return true;
    }
  } else if (chrome.offscreen.hasDocument) {
    const hasDoc = await chrome.offscreen.hasDocument();
    if (hasDoc) {
      return true;
    }
  }

  const { offscreenLock = 'idle' } = await chrome.storage.session.get('offscreenLock');
  if (offscreenLock === 'creating') {
    return true;
  }

  await chrome.storage.session.set({ offscreenLock: 'creating' });
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play continuous alarm sound when a Vibe On-Call incident email arrives until acknowledged.'
    });
    return true;
  } catch (err) {
    if (String(err.message).includes('Only a single offscreen')) {
      return true;
    }
    console.error('Error creating offscreen document:', err);
    return false;
  } finally {
    await chrome.storage.session.set({ offscreenLock: 'idle' });
  }
}

async function startOffscreenAlarm(soundType, volume, loop) {
  try {
    const ready = await ensureOffscreenDocument();
    if (!ready) {
      return false;
    }
    await chrome.runtime.sendMessage({
      type: 'OFFSCREEN_START_AUDIO',
      soundType,
      volume,
      loop
    });
    return true;
  } catch (err) {
    console.error('Failed to start offscreen alarm audio:', err);
    return false;
  }
}

async function stopOffscreenAlarm() {
  try {
    const offscreenUrl = chrome.runtime.getURL('offscreen/offscreen.html');
    if (chrome.runtime.getContexts) {
      const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl]
      });
      if (existingContexts.length === 0) {
        return;
      }
    }
    await chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP_AUDIO' });
  } catch (err) {
    console.warn('Could not stop offscreen audio:', err);
  }
}

async function triggerIncidentAlarm(payload, senderTab) {
  const {
    settings = DEFAULT_SETTINGS,
    incidentHistory = [],
    seenEmailIds = []
  } = await chrome.storage.local.get(['settings', 'incidentHistory', 'seenEmailIds']);

  if (!settings.enabled && !payload.isTest) {
    return { triggered: false, reason: 'disabled' };
  }

  const emailId = payload.id || `incident-${Date.now()}`;
  if (!payload.isTest && seenEmailIds.includes(emailId)) {
    return { triggered: false, reason: 'already_seen' };
  }

  const incident = {
    id: emailId,
    subject: payload.subject || 'Vibe On Call: You are being paged',
    sender: payload.sender || 'Vibe On Call',
    snippet: payload.snippet || '',
    provider: payload.provider || 'Webmail',
    matchedKeywords: Array.isArray(payload.matchedKeywords) ? payload.matchedKeywords : [],
    accountEmail: payload.accountEmail || settings.monitoredEmail || '',
    tabId: senderTab ? senderTab.id : (payload.tabId || null),
    windowId: senderTab ? senderTab.windowId : null,
    detectedAt: new Date().toISOString(),
    acknowledged: false,
    isTest: Boolean(payload.isTest)
  };

  const updatedSeenIds = payload.isTest
    ? seenEmailIds
    : [emailId, ...seenEmailIds.filter((id) => id !== emailId)].slice(0, 250);

  const updatedHistory = [incident, ...incidentHistory].slice(0, 30);
  const newAlarmState = {
    active: true,
    incident,
    acknowledgedAt: null
  };

  await chrome.storage.local.set({
    alarmState: newAlarmState,
    incidentHistory: updatedHistory,
    seenEmailIds: updatedSeenIds
  });

  await syncBadgeWithState(newAlarmState, settings);

  const usedOffscreen = await startOffscreenAlarm(
    settings.soundType || 'siren',
    typeof settings.volume === 'number' ? settings.volume : 0.9,
    settings.loopSound !== false
  );

  if (settings.desktopNotification !== false) {
    const notificationId = `vibe-incident::${incident.id}`;
    const baseOptions = {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: `🚨 VIBE ON CALL — YOU ARE BEING PAGED`,
      message: `${incident.subject}\nFrom: ${incident.sender} (${incident.provider})`,
      priority: 2,
      requireInteraction: true
    };
    try {
      await chrome.notifications.create(notificationId, {
        ...baseOptions,
        buttons: [
          { title: '🛑 Acknowledge & Stop Alarm' },
          { title: '📬 Open Mail Tab' }
        ]
      });
    } catch (_err) {
      try {
        await chrome.notifications.create(notificationId, baseOptions);
      } catch (err2) {
        console.error('Error creating desktop notification:', err2);
      }
    }
  }

  return { triggered: true, incident, usedOffscreen };
}

async function acknowledgeActiveAlarm() {
  const {
    settings = DEFAULT_SETTINGS,
    alarmState = DEFAULT_ALARM_STATE,
    incidentHistory = []
  } = await chrome.storage.local.get(['settings', 'alarmState', 'incidentHistory']);

  await stopOffscreenAlarm();

  const updatedHistory = incidentHistory.map((item, idx) => {
    if (idx === 0 || (alarmState.incident && item.id === alarmState.incident.id)) {
      return { ...item, acknowledged: true };
    }
    return item;
  });

  const nextAlarmState = {
    active: false,
    incident: null,
    acknowledgedAt: new Date().toISOString()
  };

  await chrome.storage.local.set({
    alarmState: nextAlarmState,
    incidentHistory: updatedHistory
  });

  await syncBadgeWithState(nextAlarmState, settings);

  try {
    const allNotifications = await chrome.notifications.getAll();
    for (const notifId of Object.keys(allNotifications)) {
      if (notifId.startsWith('vibe-incident::')) {
        await chrome.notifications.clear(notifId);
      }
    }
  } catch (err) {
    console.warn('Could not clear notifications:', err);
  }

  return { ok: true };
}

function buildMailUrlForAccount(email, providerPref) {
  const cleanEmail = (email || '').trim().toLowerCase();
  let provider = providerPref || 'auto';

  if (provider === 'auto') {
    if (cleanEmail.endsWith('@gmail.com') || cleanEmail.endsWith('@googlemail.com')) {
      provider = 'gmail';
    } else if (cleanEmail.endsWith('@outlook.com') || cleanEmail.endsWith('@hotmail.com') || cleanEmail.endsWith('@live.com')) {
      provider = 'outlook-live';
    } else {
      provider = 'outlook';
    }
  }

  if (provider === 'gmail') {
    return cleanEmail
      ? `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(cleanEmail)}`
      : 'https://mail.google.com/mail/';
  }

  if (provider === 'outlook-live') {
    return cleanEmail
      ? `https://outlook.live.com/mail/?login_hint=${encodeURIComponent(cleanEmail)}`
      : 'https://outlook.live.com/mail/';
  }

  return cleanEmail
    ? `https://outlook.office.com/mail/?login_hint=${encodeURIComponent(cleanEmail)}`
    : 'https://outlook.office.com/mail/';
}

async function getConnectionStatus() {
  try {
    const { settings = DEFAULT_SETTINGS, detectedAccountEmail = '' } =
      await chrome.storage.local.get(['settings', 'detectedAccountEmail']);

    const tabs = await chrome.tabs.query({ url: WEBMAIL_URL_PATTERNS });
    const cleanTarget = (settings.monitoredEmail || '').trim().toLowerCase();

    let matchingTab = null;
    if (cleanTarget && tabs.length > 0) {
      matchingTab = tabs.find((t) => {
        const title = (t.title || '').toLowerCase();
        const url = (t.url || '').toLowerCase();
        return title.includes(cleanTarget) || url.includes(encodeURIComponent(cleanTarget));
      });
    }
    if (!matchingTab && tabs.length > 0) {
      matchingTab = tabs[0];
    }

    return {
      connected: tabs.length > 0,
      openTabCount: tabs.length,
      activeTabTitle: matchingTab ? matchingTab.title : '',
      activeTabId: matchingTab ? matchingTab.id : null,
      detectedAccountEmail: detectedAccountEmail || '',
      monitoredEmail: settings.monitoredEmail || ''
    };
  } catch (err) {
    console.warn('Error checking connection status:', err);
    return {
      connected: false,
      openTabCount: 0,
      activeTabTitle: '',
      activeTabId: null,
      detectedAccountEmail: '',
      monitoredEmail: ''
    };
  }
}

async function connectOrOpenMailbox(email, providerPref) {
  try {
    const tabs = await chrome.tabs.query({ url: WEBMAIL_URL_PATTERNS });
    const cleanEmail = (email || '').trim().toLowerCase();

    let targetTab = null;
    if (cleanEmail) {
      targetTab = tabs.find((t) => {
        const title = (t.title || '').toLowerCase();
        const url = (t.url || '').toLowerCase();
        return title.includes(cleanEmail) || url.includes(encodeURIComponent(cleanEmail));
      });
    }

    if (!targetTab && tabs.length > 0 && !cleanEmail) {
      targetTab = tabs[0];
    }

    if (targetTab && targetTab.id) {
      await chrome.tabs.update(targetTab.id, { active: true });
      if (targetTab.windowId) {
        await chrome.windows.update(targetTab.windowId, { focused: true });
      }
      try {
        await chrome.tabs.sendMessage(targetTab.id, { type: 'TRIGGER_SCAN' });
      } catch (_e) {
        // Content script still loading
      }
      return { ok: true, action: 'focused', tabId: targetTab.id };
    }

    const url = buildMailUrlForAccount(email, providerPref);
    const created = await chrome.tabs.create({ url, active: true });
    return { ok: true, action: 'opened', tabId: created.id };
  } catch (err) {
    console.error('Error connecting mailbox:', err);
    return { ok: false, error: err.message };
  }
}

async function focusMailTab(tabId, windowId) {
  try {
    if (tabId) {
      await chrome.tabs.update(tabId, { active: true });
      if (windowId) {
        await chrome.windows.update(windowId, { focused: true });
      }
      return { ok: true };
    }

    const tabs = await chrome.tabs.query({ url: WEBMAIL_URL_PATTERNS });
    if (tabs.length > 0) {
      const target = tabs[0];
      await chrome.tabs.update(target.id, { active: true });
      if (target.windowId) {
        await chrome.windows.update(target.windowId, { focused: true });
      }
      return { ok: true };
    }
  } catch (err) {
    console.warn('Could not focus mail tab:', err);
  }
  return { ok: false };
}

// Top-level synchronous listener registrations
chrome.runtime.onInstalled.addListener(() => {
  initializeDefaults();
});

chrome.runtime.onStartup.addListener(() => {
  initializeDefaults();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'vibe-heartbeat-scan') return;
  try {
    const { settings = DEFAULT_SETTINGS, alarmState = DEFAULT_ALARM_STATE } =
      await chrome.storage.local.get(['settings', 'alarmState']);

    await syncBadgeWithState(alarmState, settings);

    if (!settings.enabled) return;

    const tabs = await chrome.tabs.query({ url: WEBMAIL_URL_PATTERNS });

    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_SCAN' });
      } catch (_err) {
        // Content script may not be ready yet in that tab
      }
    }
  } catch (err) {
    console.error('Error in heartbeat scan alarm:', err);
  }
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (!notificationId.startsWith('vibe-incident::')) return;
  const { alarmState = DEFAULT_ALARM_STATE } = await chrome.storage.local.get('alarmState');
  const tabId = alarmState.incident ? alarmState.incident.tabId : null;
  const windowId = alarmState.incident ? alarmState.incident.windowId : null;
  await acknowledgeActiveAlarm();
  await focusMailTab(tabId, windowId);
});

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (!notificationId.startsWith('vibe-incident::')) return;
  const { alarmState = DEFAULT_ALARM_STATE } = await chrome.storage.local.get('alarmState');
  const tabId = alarmState.incident ? alarmState.incident.tabId : null;
  const windowId = alarmState.incident ? alarmState.incident.windowId : null;

  await acknowledgeActiveAlarm();
  if (buttonIndex === 1) {
    await focusMailTab(tabId, windowId);
  }
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.settings || changes.alarmState) {
    const { settings = DEFAULT_SETTINGS, alarmState = DEFAULT_ALARM_STATE } =
      await chrome.storage.local.get(['settings', 'alarmState']);
    await syncBadgeWithState(alarmState, settings);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') {
    return false;
  }

  if (message.type === 'INCIDENT_DETECTED') {
    (async () => {
      try {
        const result = await triggerIncidentAlarm(message.payload || {}, sender.tab || null);
        sendResponse(result);
      } catch (err) {
        console.error('Error handling INCIDENT_DETECTED:', err);
        sendResponse({ triggered: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'ACKNOWLEDGE_ALARM') {
    (async () => {
      try {
        const result = await acknowledgeActiveAlarm();
        sendResponse(result);
      } catch (err) {
        console.error('Error handling ACKNOWLEDGE_ALARM:', err);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'GET_CONNECTION_STATUS') {
    (async () => {
      const status = await getConnectionStatus();
      sendResponse(status);
    })();
    return true;
  }

  if (message.type === 'CONNECT_MAILBOX') {
    (async () => {
      const res = await connectOrOpenMailbox(message.email || '', message.provider || 'auto');
      sendResponse(res);
    })();
    return true;
  }

  if (message.type === 'PREVIEW_SOUND') {
    (async () => {
      try {
        await startOffscreenAlarm(
          message.soundType || 'siren',
          typeof message.volume === 'number' ? message.volume : 0.9,
          false
        );
        sendResponse({ ok: true });
      } catch (err) {
        console.error('Error previewing sound:', err);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'STOP_SOUND') {
    (async () => {
      try {
        await stopOffscreenAlarm();
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'FOCUS_MAIL_TAB') {
    (async () => {
      try {
        const res = await focusMailTab(message.tabId || null, message.windowId || null);
        sendResponse(res);
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'CLEAR_HISTORY') {
    (async () => {
      try {
        const clearSeen = Boolean(message.resetSeen);
        const updates = { incidentHistory: [] };
        if (clearSeen) {
          updates.seenEmailIds = [];
        }
        await chrome.storage.local.set(updates);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  return false;
});
