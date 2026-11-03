// Selection Reader — background service worker
//
// Two speech engines:
// - chrome.tts for the browser's and the system's voices. It runs here rather than
//   in the page: the page's speechSynthesis refuses to speak ("not-allowed") unless
//   the page itself has had a recent click or key press, which a context-menu click
//   or an extension shortcut doesn't count as.
// - Kokoro, a voice model that runs locally in the offscreen document
//   (offscreen.html), since a service worker can't run it or play audio.

// ── Settings ─────────────────────────────────────────────
// Saved by the popup in chrome.storage.sync: voiceName, rate, device ('auto' |
// 'gpu' | 'cpu', for Kokoro) and highlight (highlight each word while reading).
const DEFAULT_VOICE = 'kokoro:af_bella'; // Bella is bundled (see build.mjs), so a fresh install reads offline straight away
// Speed presets, named like Edge's Read Aloud; the widget's speed button cycles them.
const SPEEDS = [
  { label: 'Slow', rate: 0.9 },
  { label: 'Normal', rate: 1 },
  { label: 'Fast', rate: 1.1 },
];
const DEFAULT_RATE = 1;
const MAX_CHUNK = 220; // long sentences get split so network voices don't cut off
const KOKORO = 'kokoro:'; // prefix of Kokoro voice names, e.g. "kokoro:bf_emma"

const settings = async () => ({
  voiceName: DEFAULT_VOICE, rate: DEFAULT_RATE, device: 'auto', highlight: true,
  ...(await chrome.storage.sync.get(['voiceName', 'rate', 'device', 'highlight'])),
});

// The preset closest to a rate (older versions saved rates like 0.85).
const speedIndex = (rate) =>
  SPEEDS.reduce((best, s, i) => (Math.abs(s.rate - rate) < Math.abs(SPEEDS[best].rate - rate) ? i : best), 0);

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'read-selection',
    title: 'Read selection aloud',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'stop-reading',
    title: 'Stop reading',
    contexts: ['all'],
  });
});

// Voice picked in the popup first, then sensible fallbacks (e.g. on another machine).
async function pickVoice(voiceName) {
  if (voiceName.startsWith(KOKORO)) return { voiceName, kokoro: voiceName.slice(KOKORO.length) };
  const voices = await chrome.tts.getVoices();
  const voice =
    voices.find((v) => v.voiceName === voiceName) ||
    voices.find((v) => /\((Premium|Enhanced)\)/.test(v.voiceName) && v.lang?.startsWith('en')) ||
    voices.find((v) => v.voiceName.includes('Natural') && v.lang?.startsWith('en')) ||
    voices.find((v) => v.lang === 'en-GB') ||
    null;
  console.info('[Selection Reader] voice:', voice?.voiceName ?? 'browser default');
  return voice;
}

// Split the selection into sentences.
function toChunks(text) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
  const chunks = [];
  for (const { segment } of segmenter.segment(text)) {
    const sentence = segment.replace(/\s+/g, ' ').trim();
    if (sentence) chunks.push(...splitLong(sentence));
  }
  return chunks;
}

// Break very long sentences, preferring to break after a comma, semicolon or colon.
function splitLong(sentence) {
  if (sentence.length <= MAX_CHUNK) return [sentence];
  const out = [];
  let current = '';
  for (const word of sentence.split(' ')) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > MAX_CHUNK && current) {
      out.push(current);
      current = word;
    } else {
      current = candidate;
      if (/[,;:]$/.test(word) && current.length > MAX_CHUNK / 2) {
        out.push(current);
        current = '';
      }
    }
  }
  if (current) out.push(current);
  return out;
}

// Shortcut and context menu: ask the page widget in the frame holding the selection
// (page.js runs in every frame, e.g. lessons embedded in an iframe) to start reading,
// as if its Read button was pressed; it sends 'read' back from its own frame.
// frameId narrows the question to one frame (the context menu knows it).
async function readSelectionIn(tabId, { frameId, fallbackText } = {}) {
  const options = frameId == null ? {} : { frameId };
  const ask = () => chrome.tabs.sendMessage(tabId, { type: 'reader-read-selection' }, options);
  const taken = await ask().catch(async () => {
    // page.js isn't in this tab yet (opened before the extension was installed or reloaded).
    const target = frameId == null ? { tabId, allFrames: true } : { tabId, frameIds: [frameId] };
    await chrome.scripting.executeScript({ target, files: ['page.js'] }).catch(() => {});
    return ask().catch(() => false);
  });
  if (taken) return;

  // No widget could take it (e.g. the built-in PDF viewer): read the plain text,
  // without highlighting.
  let text = fallbackText?.trim();
  if (!text) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.getSelection().toString(),
      });
      text = result?.trim();
    } catch (err) {
      // Extensions can't run on chrome:// pages, the Web Store, or the built-in PDF viewer.
      console.warn('Selection Reader could not run on this page:', err.message);
    }
  }
  if (text) read(tabId, { text, fromPage: false });
}

// ── Engines ──────────────────────────────────────────────
// Each has speakFrom(session, start), pause(), resume(), stop() and setRate(session).

const ttsEngine = {
  // Speak the session's chunks from `start` on, replacing anything queued.
  // Each call gets its own token so events from the replaced queue are ignored.
  speakFrom(s, start) {
    const token = (s.token = {});
    const last = s.chunks.length - 1;
    s.chunks.slice(start).forEach((chunk, offset) => {
      const i = start + offset;
      chrome.tts.speak(chunk, {
        voiceName: s.voice?.voiceName,
        lang: s.voice?.lang,
        rate: s.rate,
        enqueue: offset > 0, // the first chunk replaces anything still playing
        onEvent: (e) => {
          if (session !== s || s.token !== token) return; // replaced, restarted or stopped
          if (e.type === 'start') sentenceStarted(s, i);
          // charIndex is where the word starts in the chunk; count the words before it.
          if (e.type === 'word') wordReached(s, i, chunk.slice(0, e.charIndex).split(' ').length - 1);
          if (e.type === 'end' && i === last) finish();
          if (e.type === 'error') {
            console.warn('[Selection Reader] speech error:', e.errorMessage);
            if (i === last) finish();
          }
        },
      });
    });
  },
  pause: () => chrome.tts.pause(),
  resume: () => chrome.tts.resume(),
  stop: () => chrome.tts.stop(),
  // chrome.tts can't change the rate mid-utterance, so the current sentence
  // restarts at the new speed (and plays, so don't leave the engine paused).
  setRate(s) {
    if (s.paused) {
      chrome.tts.resume();
      s.paused = false;
    }
    this.speakFrom(s, s.index - 1);
  },
};

let creatingOffscreen = null;
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      // WORKERS as well, so Chrome doesn't close it after 30 s without audio and
      // throw away the loaded model.
      reasons: ['AUDIO_PLAYBACK', 'WORKERS'],
      justification: 'Runs the local Kokoro voice model and plays the speech it generates.',
    })
    .finally(() => (creatingOffscreen = null));
  await creatingOffscreen;
}

const toOffscreen = (msg) =>
  chrome.runtime.sendMessage({ target: 'offscreen', ...msg }).catch(() => {
    // No offscreen document yet: nothing is playing there.
  });

const kokoroEngine = {
  async speakFrom(s, start) {
    await ensureOffscreen();
    if (session !== s) return; // stopped while the document was being created
    toOffscreen({
      type: 'speak', id: s.id, chunks: s.chunks, voice: s.voice.kokoro, rate: s.rate, device: s.device, start,
    });
  },
  pause: () => toOffscreen({ type: 'pause' }),
  resume: () => toOffscreen({ type: 'resume' }),
  stop: () => toOffscreen({ type: 'stop' }),
  setRate: (s) => toOffscreen({ type: 'rate', rate: s.rate }), // applies mid-sentence
};

// Start loading Kokoro as soon as text is selected, so reading starts sooner.
async function prepare() {
  const { voiceName, device } = await settings();
  if (!voiceName.startsWith(KOKORO)) return;
  await ensureOffscreen();
  toOffscreen({ type: 'load', device });
}

// Time Kokoro on the GPU and the CPU (popup's Benchmark button). Progress and
// results go to chrome.storage.local.benchmark, where the popup reads them.
async function benchmark() {
  await chrome.storage.local.set({ benchmark: { state: 'running', device: 'gpu', startedAt: Date.now() } });
  await ensureOffscreen();
  toOffscreen({ type: 'benchmark' });
}

// ── Reading ──────────────────────────────────────────────
// The reading in progress, or null:
// { id, tabId, frameId, engine, chunks, voice, rate, device, index, total, paused,
//   status, wordOffsets, highlight }
// tabId is null for the popup's sample; frameId is the frame whose widget shows the
// player (0 = the page itself, others are iframes). index/total/paused/rate/status
// are what the widget shows; status is set while Kokoro loads ("Loading voice…").
// wordOffsets[i] is how many words come before chunk i; highlight is whether to
// send the widget each word as it's read.
let session = null;
let nextId = 1;

// Send the reading's widget a message (only its frame, so other frames stay quiet).
function toWidget(s, msg) {
  if (s.tabId == null) return;
  chrome.tabs.sendMessage(s.tabId, msg, { frameId: s.frameId }).catch(() => {
    // The page went away or was reloaded; nothing to update.
  });
}

// Tell the widget what's happening (null hides the player).
const updateBar = (s, state) => toWidget(s, { type: 'reader-state', state });

// page.js normally loads with every page; inject it for tabs opened before the
// extension was installed or reloaded (it guards against loading twice).
async function showBar(s) {
  if (s.tabId == null) return;
  await chrome.scripting
    .executeScript({ target: { tabId: s.tabId, frameIds: [s.frameId] }, files: ['page.js'] })
    .catch(() => {
      // Not allowed on this page (or no need: page.js usually loads with the page).
    });
  if (session === s) updateBar(s, barState(s));
}

const barState = ({ index, total, paused, rate, status, highlight }) => ({
  index, total, paused, rate, status, highlight, speed: SPEEDS[speedIndex(rate)].label,
});

function sentenceStarted(s, i) {
  s.index = i + 1;
  s.status = null;
  updateBar(s, barState(s));
}

// Word `word` of chunk `chunk` is being spoken: tell the widget to highlight it.
function wordReached(s, chunk, word) {
  if (s.highlight) toWidget(s, { type: 'reader-word', index: s.wordOffsets[chunk] + word });
}

// Read `text` aloud. It comes from a page widget (which kept each word's place on the
// page for highlighting: word i of the text is word i there), from the popup's sample
// (tabId null), or as plain text when no widget could take the selection.
async function read(tabId, { text, frameId = 0, fromPage = true }) {
  if (!text?.trim()) return;

  stop();
  const prefs = await settings();
  const voice = await pickVoice(prefs.voiceName);
  const chunks = toChunks(text);
  let words = 0;
  const wordOffsets = chunks.map((chunk) => {
    const before = words;
    words += chunk.split(' ').length;
    return before;
  });
  const engine = voice?.kokoro ? kokoroEngine : ttsEngine;
  const s = (session = {
    id: nextId++, tabId, frameId, engine, chunks, voice, rate: prefs.rate, device: prefs.device,
    index: 1, total: chunks.length, paused: false,
    status: engine === kokoroEngine ? 'Loading voice…' : null,
    wordOffsets, highlight: prefs.highlight && fromPage && tabId != null,
  });
  keepAlive(true);
  showBar(s);
  engine.speakFrom(s, 0);
}

function togglePause() {
  if (!session) return;
  session.paused = !session.paused;
  session.paused ? session.engine.pause() : session.engine.resume();
  updateBar(session, barState(session));
}

// Step to the next speed preset (Slow → Normal → Fast → Slow) and save it.
async function nextSpeed() {
  const { rate } = await settings();
  await chrome.storage.sync.set({ rate: SPEEDS[(speedIndex(rate) + 1) % SPEEDS.length].rate });
}

// A new speed (from the widget or the popup) applies straight away.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.rate || !session) return;
  session.rate = changes.rate.newValue ?? DEFAULT_RATE;
  session.engine.setRate(session);
  updateBar(session, barState(session));
});

function finish() {
  if (session) updateBar(session, null);
  session = null;
  keepAlive(false);
}

function stop() {
  finish(); // clear the session first so the stop's "interrupted" events are ignored
  ttsEngine.stop();
  kokoroEngine.stop();
}

// Chrome stops an idle service worker after ~30 s, which would lose the session
// (e.g. while paused). Any extension API call counts as activity.
let keepAliveTimer = null;
function keepAlive(on) {
  clearInterval(keepAliveTimer);
  keepAliveTimer = on ? setInterval(() => chrome.runtime.getPlatformInfo(), 20_000) : null;
}

// ── Events ───────────────────────────────────────────────

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'read-selection' && tab?.id) readSelectionIn(tab.id);
  if (command === 'toggle-pause') togglePause();
  if (command === 'stop-reading') stop();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'read-selection' && tab?.id) {
    readSelectionIn(tab.id, { frameId: info.frameId, fallbackText: info.selectionText });
  }
  if (info.menuItemId === 'stop-reading') stop();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  // From the page widget (page.js).
  if (msg.type === 'reader-get-state') {
    const mine = session && session.tabId === tabId && session.frameId === sender.frameId;
    sendResponse(mine ? barState(session) : null);
    return;
  }
  if (msg.type === 'reader-control') {
    if (msg.action === 'prepare') prepare();
    if (msg.action === 'read' && tabId) read(tabId, { text: msg.text, frameId: sender.frameId });
    if (msg.action === 'toggle') togglePause();
    if (msg.action === 'speed') nextSpeed();
    if (msg.action === 'stop') stop();
    return;
  }

  // From the popup.
  if (msg.type === 'reader-sample') read(null, { text: msg.text, fromPage: false });
  if (msg.type === 'reader-benchmark') benchmark();

  // From the Kokoro player (offscreen.js).
  if (msg.type === 'kokoro-benchmark') {
    const { state, device, results, at } = msg;
    chrome.storage.local.set({
      benchmark: state === 'done' ? { state, results, at } : { state, device, startedAt: Date.now() },
    });
    return;
  }
  if (msg.type === 'kokoro-event') {
    const s = session;
    if (!s || s.id !== msg.id) return; // a reading that was replaced or stopped
    if (msg.event === 'loading' && s.index === 1) s.status = 'Loading voice…';
    if (msg.event === 'progress') s.status = `Downloading voice ${msg.percent}%`;
    if (msg.event === 'word') return wordReached(s, msg.index, msg.word);
    if (msg.event === 'start') return sentenceStarted(s, msg.index);
    if (msg.event === 'end') return finish();
    if (msg.event === 'error') {
      console.warn('[Selection Reader] Kokoro error:', msg.message);
      return finish();
    }
    updateBar(s, barState(s));
  }
});
