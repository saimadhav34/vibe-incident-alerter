// Offscreen document for playing continuous Web Audio API incident alarms.
// Follows Chrome MV3 rules: only uses Web Audio API and chrome.runtime messaging.

let audioCtx = null;
let loopIntervalId = null;
let isPlaying = false;

function getAudioContext() {
  if (!audioCtx || audioCtx.state === 'closed') {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  return audioCtx;
}

async function ensureAudioContextResumed() {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch (err) {
      console.warn('Could not resume AudioContext:', err);
    }
  }
  return ctx;
}

function playSirenCycle(ctx, volume) {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(620, now);
  osc.frequency.linearRampToValueAtTime(960, now + 0.45);
  osc.frequency.linearRampToValueAtTime(620, now + 0.9);

  const safeVol = Math.max(0.05, Math.min(1.0, volume)) * 0.45;
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.exponentialRampToValueAtTime(safeVol, now + 0.05);
  gain.gain.setValueAtTime(safeVol, now + 0.85);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.96);
}

function playPagerCycle(ctx, volume) {
  const now = ctx.currentTime;
  const safeVol = Math.max(0.05, Math.min(1.0, volume)) * 0.5;
  const offsets = [0, 0.16, 0.32, 0.64, 0.80, 0.96];
  const freqs = [987.77, 1318.51, 987.77, 987.77, 1318.51, 1567.98];

  for (let i = 0; i < offsets.length; i++) {
    const start = now + offsets[i];
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(freqs[i], start);

    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(safeVol, start + 0.01);
    gain.gain.setValueAtTime(safeVol, start + 0.09);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.11);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(start);
    osc.stop(start + 0.12);
  }
}

function playChimeCycle(ctx, volume) {
  const now = ctx.currentTime;
  const safeVol = Math.max(0.05, Math.min(1.0, volume)) * 0.55;
  const notes = [523.25, 659.25, 783.99, 1046.50];

  for (let i = 0; i < notes.length; i++) {
    const start = now + i * 0.18;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(notes[i], start);

    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(safeVol, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.38);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(start);
    osc.stop(start + 0.4);
  }
}

function playRadarCycle(ctx, volume) {
  const now = ctx.currentTime;
  const safeVol = Math.max(0.05, Math.min(1.0, volume)) * 0.5;
  const pulses = [0, 0.25, 0.5];

  for (let i = 0; i < pulses.length; i++) {
    const start = now + pulses[i];
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1350, start);
    osc.frequency.exponentialRampToValueAtTime(850, start + 0.18);

    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(safeVol, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.19);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(start);
    osc.stop(start + 0.2);
  }
}

function triggerSinglePattern(ctx, soundType, volume) {
  switch (soundType) {
    case 'pager':
      playPagerCycle(ctx, volume);
      break;
    case 'chime':
      playChimeCycle(ctx, volume);
      break;
    case 'radar':
      playRadarCycle(ctx, volume);
      break;
    case 'siren':
    default:
      playSirenCycle(ctx, volume);
      break;
  }
}

function stopAudioPlayback() {
  isPlaying = false;
  if (loopIntervalId !== null) {
    clearInterval(loopIntervalId);
    loopIntervalId = null;
  }
  if (audioCtx && audioCtx.state !== 'closed') {
    try {
      audioCtx.close();
    } catch (err) {
      console.warn('Error closing AudioContext:', err);
    }
    audioCtx = null;
  }
}

async function startAudioPlayback({ soundType = 'siren', volume = 0.85, loop = true }) {
  stopAudioPlayback();
  const ctx = await ensureAudioContextResumed();
  isPlaying = true;

  triggerSinglePattern(ctx, soundType, volume);

  if (loop) {
    const intervalMs = soundType === 'siren' ? 1100 : 1450;
    loopIntervalId = setInterval(async () => {
      if (!isPlaying) return;
      const activeCtx = await ensureAudioContextResumed();
      triggerSinglePattern(activeCtx, soundType, volume);
    }, intervalMs);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') {
    return false;
  }

  if (message.type === 'OFFSCREEN_START_AUDIO') {
    (async () => {
      try {
        await startAudioPlayback({
          soundType: message.soundType || 'siren',
          volume: typeof message.volume === 'number' ? message.volume : 0.85,
          loop: message.loop !== false
        });
        sendResponse({ ok: true });
      } catch (err) {
        console.error('Failed to start offscreen audio:', err);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'OFFSCREEN_STOP_AUDIO') {
    stopAudioPlayback();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
