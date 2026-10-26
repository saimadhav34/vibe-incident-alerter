// Content Script for Vibe Incident Email Alerter (Chrome & Edge)
// Monitors Gmail and Outlook Web for incoming Vibe On-Call paging emails.

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
  matchMode: 'smart', // 'smart' | 'all' | 'any'
  senderFilter: '',
  unreadOnly: true,
  alertOnExistingUnread: true,
  loopSound: true,
  soundType: 'siren',
  volume: 0.9,
  desktopNotification: true,
  inPageBanner: true
};

let currentSettings = { ...DEFAULT_SETTINGS };
let currentAlarmState = { active: false, incident: null };
let localSeenIds = new Set();
let hasCompletedInitialScan = false;
let scanInProgress = false;
let pendingScanTimer = null;
let lastMatchedElement = null;

// Fallback in-page audio context (used only if background offscreen audio is unavailable)
let fallbackAudioCtx = null;
let fallbackIntervalId = null;

function detectProvider() {
  const host = window.location.hostname.toLowerCase();
  if (host.includes('mail.google.com')) {
    return 'Gmail';
  }
  if (host.includes('outlook.')) {
    return 'Outlook Web';
  }
  return 'Webmail';
}

function normalizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[-_:/\\|•·,.;!?()"'[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectLoggedInAccountEmail() {
  // Check page title (Gmail & Outlook Web frequently include the user's email in document.title)
  const titleMatch = (document.title || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (titleMatch) {
    return titleMatch[0].toLowerCase();
  }

  // Check common account badge selectors in Gmail and Outlook Web
  const accountSelectors = [
    'a[aria-label*="@"]',
    'button[aria-label*="@"]',
    'div[aria-label*="@"][role="button"]',
    '[data-email]'
  ];
  for (const sel of accountSelectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const raw = `${el.getAttribute('data-email') || ''} ${el.getAttribute('aria-label') || ''}`;
    const match = raw.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (match) {
      return match[0].toLowerCase();
    }
  }
  return '';
}

function computeEmailFingerprint(provider, sender, subject, snippet) {
  const normSender = normalizeForMatch(sender).slice(0, 60);
  const normSubject = normalizeForMatch(subject).slice(0, 120);
  const normSnippet = normalizeForMatch(snippet).slice(0, 80);
  const raw = `${provider}|${normSender}|${normSubject}|${normSnippet}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `vibe-${(hash >>> 0).toString(16)}`;
}

function extractGmailRowData(row) {
  // Handle open message view container as well as inbox row tr.zA
  if (!row.matches('tr.zA')) {
    const subjectEl = document.querySelector('h2.hP');
    const senderEl = document.querySelector('span.gD');
    const bodyText = (row.innerText || '').trim();
    const sender = senderEl
      ? `${senderEl.textContent || ''} ${senderEl.getAttribute('email') || ''}`.trim()
      : 'Vibe On Call';
    const subject = subjectEl ? (subjectEl.textContent || '').trim() : 'Open Gmail Message';
    return {
      element: row,
      isUnread: true,
      sender,
      subject,
      snippet: bodyText.slice(0, 220),
      fullText: `${sender} ${subject} ${bodyText}`
    };
  }

  const isUnread =
    row.classList.contains('zE') ||
    row.querySelector('.zF') !== null ||
    Boolean(row.getAttribute('aria-label') && row.getAttribute('aria-label').toLowerCase().includes('unread'));

  const senderNodes = row.querySelectorAll('.yW [email], .zF, .yX span[email], .yW span');
  const senderParts = [];
  for (const node of senderNodes) {
    const name = (node.textContent || '').trim();
    const emailAttr = node.getAttribute('email') || '';
    if (name && !senderParts.includes(name)) senderParts.push(name);
    if (emailAttr && !senderParts.includes(emailAttr)) senderParts.push(emailAttr);
  }
  const sender = senderParts.join(' ') || 'Unknown Sender';

  const subjectEl = row.querySelector('.bog, .y6 span[id], .y6');
  const subject = subjectEl ? (subjectEl.textContent || '').trim() : '';

  const snippetEl = row.querySelector('.y2');
  const snippet = snippetEl ? (snippetEl.textContent || '').replace(/^\s*-\s*/, '').trim() : '';

  return {
    element: row,
    isUnread,
    sender,
    subject,
    snippet,
    fullText: `${sender} ${subject} ${snippet} ${row.innerText || ''}`
  };
}

function extractOutlookRowData(row) {
  const ariaLabel = row.getAttribute('aria-label') || '';
  const ariaLower = ariaLabel.toLowerCase();

  // Check if this is an open reading pane body or live toast alert
  const isReadingPaneOrToast =
    row.getAttribute('role') === 'alert' ||
    ariaLower.includes('message body') ||
    row.hasAttribute('data-app-section');

  const isUnread =
    isReadingPaneOrToast ||
    ariaLower.startsWith('unread') ||
    ariaLower.includes('unread ') ||
    row.querySelector('[title*="Unread" i], [aria-label*="Unread" i]') !== null;

  const senderEl = row.querySelector('[title*="@"], [data-testid*="sender" i], span[title]');
  let sender = senderEl
    ? `${(senderEl.textContent || '').trim()} ${senderEl.getAttribute('title') || ''}`.trim()
    : '';

  const textLines = (row.innerText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length < 400);

  if (!sender && textLines.length > 0) {
    sender = textLines[0];
  }

  let subject = '';
  let snippet = '';
  if (textLines.length >= 2) {
    subject = textLines[1];
    snippet = textLines.slice(2).join(' ');
  } else if (ariaLabel) {
    const cleaned = ariaLabel.replace(/^Unread\s+/i, '').replace(/^Flagged\s+/i, '');
    subject = cleaned.slice(0, 140);
    snippet = cleaned;
  } else if (textLines.length === 1) {
    subject = textLines[0].slice(0, 140);
    snippet = textLines[0];
  }

  return {
    element: row,
    isUnread,
    sender: sender || 'Vibe On Call',
    subject: subject || '(Outlook Message)',
    snippet: (snippet || ariaLabel).slice(0, 240),
    fullText: `${ariaLabel} ${sender} ${subject} ${snippet} ${row.innerText || ''}`
  };
}

function collectCandidateElements(provider) {
  if (provider === 'Gmail') {
    return Array.from(document.querySelectorAll('tr.zA, div.a3s.aiL'));
  }
  // Outlook Web (Office 365, Live, Cloud Microsoft on Edge & Chrome)
  const selector = [
    'div[data-convid]',
    '[role="option"][aria-label]',
    '[role="listitem"][aria-label]',
    '[aria-label*="Message body" i]',
    '[role="alert"]'
  ].join(', ');
  return Array.from(document.querySelectorAll(selector));
}

function evaluateEmailMatch(emailData, settings) {
  if (settings.unreadOnly && !emailData.isUnread) {
    return { matched: false, matchedKeywords: [] };
  }

  const rawKeywords = Array.isArray(settings.keywords) ? settings.keywords : DEFAULT_KEYWORDS;
  const activeKeywords = rawKeywords
    .map((k) => normalizeForMatch(k))
    .filter((k) => k.length > 0);

  if (activeKeywords.length === 0) {
    return { matched: false, matchedKeywords: [] };
  }

  // Optional sender filter
  const senderFilterRaw = normalizeForMatch(settings.senderFilter || '');
  if (senderFilterRaw.length > 0) {
    const senderTokens = (settings.senderFilter || '')
      .split(',')
      .map((s) => normalizeForMatch(s))
      .filter(Boolean);
    const haystackSender = normalizeForMatch(`${emailData.sender} ${emailData.fullText}`);
    const senderMatches = senderTokens.some((token) => haystackSender.includes(token));
    if (!senderMatches) {
      return { matched: false, matchedKeywords: [] };
    }
  }

  const normalizedHaystack = normalizeForMatch(
    `${emailData.subject} ${emailData.sender} ${emailData.snippet} ${emailData.fullText}`
  );

  const matchedKeywords = [];
  for (let i = 0; i < activeKeywords.length; i++) {
    const normKw = activeKeywords[i];
    if (normalizedHaystack.includes(normKw)) {
      matchedKeywords.push(rawKeywords[i] || normKw);
    }
  }

  if (settings.matchMode === 'any') {
    return {
      matched: matchedKeywords.length > 0,
      matchedKeywords
    };
  }

  if (settings.matchMode === 'all') {
    return {
      matched: matchedKeywords.length === activeKeywords.length,
      matchedKeywords
    };
  }

  // 'smart' mode (Default for Vibe On-Call Cibranium Labs paging):
  // 1. Matches if all configured keywords are present
  // 2. Also matches if at least 2 of the configured phrases are present (in case inbox snippet truncates the 3rd phrase)
  // 3. Also matches if "you are being paged" AND ("vibe" or "cibranium") appear anywhere in the row
  if (matchedKeywords.length === activeKeywords.length) {
    return { matched: true, matchedKeywords };
  }
  if (activeKeywords.length >= 2 && matchedKeywords.length >= 2) {
    return { matched: true, matchedKeywords };
  }
  const hasBeingPaged = normalizedHaystack.includes('you are being paged');
  const hasVibeOrCibranium =
    normalizedHaystack.includes('vibe on call') ||
    normalizedHaystack.includes('cibranium labs') ||
    normalizedHaystack.includes('vibe');

  if (hasBeingPaged && hasVibeOrCibranium) {
    return {
      matched: true,
      matchedKeywords: matchedKeywords.length > 0 ? matchedKeywords : ['vibe on call', 'you are being paged']
    };
  }

  return { matched: false, matchedKeywords: [] };
}

async function markElementHighlighted(element) {
  if (!element) return;
  lastMatchedElement = element;
  await new Promise((resolve) => {
    requestAnimationFrame(() => {
      element.classList.add('vibe-incident-matched-row');
      resolve();
    });
  });
}

async function scanInboxBatched() {
  if (scanInProgress || !currentSettings.enabled) return;
  scanInProgress = true;

  try {
    const provider = detectProvider();
    const detectedEmail = detectLoggedInAccountEmail();
    if (detectedEmail) {
      await chrome.storage.local.set({ detectedAccountEmail: detectedEmail });
    }

    const elements = collectCandidateElements(provider);
    const BATCH_SIZE = 20;

    for (let i = 0; i < elements.length; i += BATCH_SIZE) {
      const batch = elements.slice(i, i + BATCH_SIZE);
      const batchMatches = [];

      await new Promise((resolve) => {
        requestAnimationFrame(() => {
          for (const el of batch) {
            const emailData =
              provider === 'Gmail' ? extractGmailRowData(el) : extractOutlookRowData(el);
            if (!emailData.subject && !emailData.fullText.trim()) continue;

            const { matched, matchedKeywords } = evaluateEmailMatch(emailData, currentSettings);
            if (matched) {
              const id = computeEmailFingerprint(
                provider,
                emailData.sender,
                emailData.subject,
                emailData.snippet
              );
              batchMatches.push({
                id,
                emailData,
                matchedKeywords
              });
            }
          }
          resolve();
        });
      });

      for (const match of batchMatches) {
        if (localSeenIds.has(match.id)) {
          continue;
        }

        localSeenIds.add(match.id);

        if (!hasCompletedInitialScan && currentSettings.alertOnExistingUnread === false) {
          continue;
        }

        await markElementHighlighted(match.emailData.element);

        try {
          const response = await chrome.runtime.sendMessage({
            type: 'INCIDENT_DETECTED',
            payload: {
              id: match.id,
              subject: match.emailData.subject,
              sender: match.emailData.sender,
              snippet: match.emailData.snippet,
              provider,
              accountEmail: detectedEmail || currentSettings.monitoredEmail || '',
              matchedKeywords: match.matchedKeywords
            }
          });

          if (response && response.triggered && response.usedOffscreen === false) {
            startFallbackAudio(
              currentSettings.soundType || 'siren',
              currentSettings.volume ?? 0.9,
              currentSettings.loopSound !== false
            );
          }
        } catch (err) {
          console.warn('Could not notify service worker of incident:', err);
        }
      }

      if (globalThis.scheduler?.yield) {
        await globalThis.scheduler.yield();
      }
    }

    hasCompletedInitialScan = true;
  } catch (err) {
    console.error('Error during inbox scan:', err);
  } finally {
    scanInProgress = false;
  }
}

function scheduleDebouncedScan() {
  if (pendingScanTimer !== null) return;
  pendingScanTimer = setTimeout(async () => {
    pendingScanTimer = null;
    await scanInboxBatched();
  }, 500);
}

// Fallback Web Audio synth if offscreen document is unavailable
function startFallbackAudio(soundType, volume, loop) {
  stopFallbackAudio();
  try {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) return;
    fallbackAudioCtx = new AudioContextClass();

    const playOnce = () => {
      if (!fallbackAudioCtx || fallbackAudioCtx.state === 'closed') return;
      const now = fallbackAudioCtx.currentTime;
      const osc = fallbackAudioCtx.createOscillator();
      const gain = fallbackAudioCtx.createGain();
      osc.type = soundType === 'pager' ? 'square' : 'sawtooth';
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.linearRampToValueAtTime(940, now + 0.4);
      gain.gain.setValueAtTime(Math.max(0.05, volume * 0.4), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
      osc.connect(gain);
      gain.connect(fallbackAudioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.88);
    };

    playOnce();
    if (loop) {
      fallbackIntervalId = setInterval(playOnce, 1100);
    }
  } catch (err) {
    console.warn('Fallback audio blocked by autoplay policy:', err);
  }
}

function stopFallbackAudio() {
  if (fallbackIntervalId !== null) {
    clearInterval(fallbackIntervalId);
    fallbackIntervalId = null;
  }
  if (fallbackAudioCtx && fallbackAudioCtx.state !== 'closed') {
    try {
      fallbackAudioCtx.close();
    } catch (_e) {
      // Ignore close error
    }
    fallbackAudioCtx = null;
  }
}

function removeInPageBanner() {
  const existing = document.getElementById('vibe-incident-alert-banner');
  if (existing) {
    existing.remove();
  }
}

function renderInPageBanner(incident) {
  removeInPageBanner();
  if (!incident || currentSettings.inPageBanner === false) return;

  const banner = document.createElement('div');
  banner.id = 'vibe-incident-alert-banner';
  banner.setAttribute('role', 'alertdialog');
  banner.setAttribute('aria-live', 'assertive');

  const header = document.createElement('div');
  header.className = 'vibe-banner-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'vibe-banner-title-group';

  const badge = document.createElement('span');
  badge.className = 'vibe-banner-badge';
  badge.textContent = '🚨 VIBE ON CALL PAGE';

  const title = document.createElement('h2');
  title.className = 'vibe-banner-title';
  title.textContent = `You Are Being Paged — Cibranium Labs (${incident.provider || detectProvider()})`;

  titleGroup.appendChild(badge);
  titleGroup.appendChild(title);
  header.appendChild(titleGroup);

  const meta = document.createElement('div');
  meta.className = 'vibe-banner-meta';

  const subjectEl = document.createElement('p');
  subjectEl.className = 'vibe-banner-subject';
  subjectEl.textContent = incident.subject || '(No Subject)';

  const senderEl = document.createElement('p');
  senderEl.className = 'vibe-banner-sender';
  senderEl.textContent = `From: ${incident.sender || 'Vibe On Call'}`;

  const snippetEl = document.createElement('p');
  snippetEl.className = 'vibe-banner-snippet';
  snippetEl.textContent =
    incident.snippet || 'From Vibe On Call: You are being paged (Cibranium Labs).';

  meta.appendChild(subjectEl);
  meta.appendChild(senderEl);
  meta.appendChild(snippetEl);

  const actions = document.createElement('div');
  actions.className = 'vibe-banner-actions';

  const keywordsInfo = document.createElement('span');
  keywordsInfo.className = 'vibe-banner-keywords';
  const kwList =
    Array.isArray(incident.matchedKeywords) && incident.matchedKeywords.length > 0
      ? incident.matchedKeywords.join(', ')
      : (currentSettings.keywords || []).join(', ');
  keywordsInfo.textContent = `Matched: ${kwList}`;

  const btnGroup = document.createElement('div');
  btnGroup.className = 'vibe-banner-btn-group';

  if (lastMatchedElement && document.body.contains(lastMatchedElement)) {
    const locateBtn = document.createElement('button');
    locateBtn.type = 'button';
    locateBtn.className = 'vibe-banner-btn vibe-banner-btn-locate';
    locateBtn.textContent = '🔍 Locate Email';
    locateBtn.addEventListener('click', () => {
      if (lastMatchedElement) {
        lastMatchedElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        lastMatchedElement.classList.add('vibe-incident-matched-row');
      }
    });
    btnGroup.appendChild(locateBtn);
  }

  const ackBtn = document.createElement('button');
  ackBtn.type = 'button';
  ackBtn.className = 'vibe-banner-btn vibe-banner-btn-ack';
  ackBtn.textContent = '🛑 Acknowledge & Stop Sound';
  ackBtn.addEventListener('click', async () => {
    stopFallbackAudio();
    removeInPageBanner();
    try {
      await chrome.runtime.sendMessage({ type: 'ACKNOWLEDGE_ALARM' });
    } catch (err) {
      console.warn('Error acknowledging alarm:', err);
    }
  });

  btnGroup.appendChild(ackBtn);
  actions.appendChild(keywordsInfo);
  actions.appendChild(btnGroup);

  banner.appendChild(header);
  banner.appendChild(meta);
  banner.appendChild(actions);

  document.body.appendChild(banner);
}

function syncBannerWithAlarmState() {
  if (currentAlarmState && currentAlarmState.active && currentAlarmState.incident) {
    renderInPageBanner(currentAlarmState.incident);
  } else {
    stopFallbackAudio();
    removeInPageBanner();
  }
}

async function initContentMonitor() {
  try {
    const stored = await chrome.storage.local.get([
      'settings',
      'alarmState',
      'seenEmailIds'
    ]);

    if (stored.settings) {
      currentSettings = { ...DEFAULT_SETTINGS, ...stored.settings };
    }
    if (stored.alarmState) {
      currentAlarmState = stored.alarmState;
    }
    if (Array.isArray(stored.seenEmailIds)) {
      localSeenIds = new Set(stored.seenEmailIds);
    }

    syncBannerWithAlarmState();

    // Observe inbox DOM changes for newly arriving emails
    const observer = new MutationObserver(() => {
      scheduleDebouncedScan();
    });

    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'aria-label']
      });
    }

    // Run initial scan once inbox DOM settles
    setTimeout(async () => {
      await scanInboxBatched();
    }, 1500);
  } catch (err) {
    console.error('Failed to initialize Vibe Incident Content Monitor:', err);
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes.settings && changes.settings.newValue) {
    currentSettings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
    scheduleDebouncedScan();
  }

  if (changes.seenEmailIds && Array.isArray(changes.seenEmailIds.newValue)) {
    localSeenIds = new Set(changes.seenEmailIds.newValue);
  }

  if (changes.alarmState && changes.alarmState.newValue) {
    currentAlarmState = changes.alarmState.newValue;
    syncBannerWithAlarmState();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') {
    return false;
  }

  if (message.type === 'TRIGGER_SCAN') {
    (async () => {
      await scanInboxBatched();
      sendResponse({ ok: true });
    })();
    return true;
  }

  return false;
});

initContentMonitor();
