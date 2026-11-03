// Selection Reader — popup: voice, speed, Supertonic's quality and where it runs
// (with a speed test and the user's own server), and word highlighting. Everything is
// saved to chrome.storage.sync as soon as it changes (the server's address and key to
// chrome.storage.local); background.js reads it when reading starts.

const DEFAULT_VOICE = 'supertonic:F1'; // keep in step with background.js
// Keep in step with SPEEDS in background.js.
const SPEEDS = [
  { label: 'Slow', rate: 0.9 },
  { label: 'Normal', rate: 1 },
  { label: 'Fast', rate: 1.1 },
];
const $ = (id) => document.getElementById(id);
const select = $('voice');

// Supertonic 3's ten preset voices (F1-F5 female, M1-M5 male); all are bundled.
const SUPERTONIC_VOICES = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'].map((id) => ({
  id,
  value: `supertonic:${id}`,
  text: `${id} (${id.startsWith('F') ? 'female' : 'male'})`,
}));

const isSupertonic = () => select.value.startsWith('supertonic:');
const SUPERTONIC_STEPS = [4, 6, 8, 16];

// ── Voice ────────────────────────────────────────────────

// items: [{ value, text }]
function addGroup(label, items, current) {
  if (!items.length) return;
  const group = document.createElement('optgroup');
  group.label = label;
  for (const { value, text } of items) group.append(new Option(text, value, false, value === current));
  select.append(group);
}

// Supertonic's settings only matter when a Supertonic voice is picked.
function showVoiceSettings() {
  const supertonic = isSupertonic();
  for (const id of ['supertonic', 'local', 'hint']) $(id).hidden = !supertonic;
}

// ── Supertonic: device, server and speed test ────────────

const DEVICE_HINTS = {
  auto: 'Uses whichever your last speed test found fastest (your server too, if set up); before one, the graphics card when there is a suitable one.',
  gpu: 'Always uses the graphics card (WebGPU). Fastest when the computer has a real one.',
  cpu: 'Uses the processor only. Works everywhere; slower, and busier on laptops.',
  server: 'Uses your own Supertonic server, set up below. If it can\'t be reached, Supertonic runs on this computer instead.',
};
const DEVICE_NAMES = { gpu: 'GPU', cpu: 'CPU', server: 'Server' };

function showDeviceHint(device) {
  $('device-hint').textContent = DEVICE_HINTS[device];
}

// The server's address as typed, without a trailing slash or path after the API's
// root ("https://host/v1/" and "https://host/" both mean https://host); '' if not a URL.
function serverAddress(text) {
  try {
    const url = new URL(text.trim());
    if (!/^https?:$/.test(url.protocol)) return '';
    return (url.origin + url.pathname.replace(/\/(v1\/?)?$/, '')).replace(/\/$/, '');
  } catch {
    return '';
  }
}

// The last speed test: { state: 'running', device } or { state: 'done', results, at },
// from chrome.storage.local.supertonicBenchmark (background.js keeps it there so it
// survives closing the popup).
function showBenchmark(bench) {
  const box = $('bench');
  const button = $('bench-run');
  // A test that never finished (e.g. the browser closed meanwhile) doesn't block a new one.
  if (bench?.state === 'running' && Date.now() - bench.startedAt > 3 * 60_000) bench = null;
  box.replaceChildren();
  button.disabled = bench?.state === 'running';
  button.textContent = bench?.state === 'running' ? 'Testing…' : bench ? 'Test again' : 'Test speed';
  if (!bench) return;
  if (bench.state === 'running') {
    box.append(resultRow(DEVICE_NAMES[bench.device], 'Testing…', ''));
    return;
  }
  for (const r of bench.results) {
    const name = DEVICE_NAMES[r.device];
    if (!r.available) {
      box.append(resultRow(name, 'Not available', r.error ?? ''));
      continue;
    }
    const ready = r.device === 'server' ? 'connected in' : 'ready in';
    const detail = `${ready} ${(r.loadMs / 1000).toFixed(1)} s, first sentence ${(r.firstMs / 1000).toFixed(1)} s`
      + (r.steps ? `, ${r.steps} steps` : '');
    box.append(resultRow(name, `${r.speed}× real time`, detail, r.speed >= 1.3 ? 'ok' : 'slow'));
  }
  // The same rule Auto uses in background.js: the fastest, if it wins by 10%.
  const [first, second] = bench.results.filter((r) => r.available).sort((a, b) => b.speed - a.speed);
  const winner = first && (!second || first.speed >= second.speed * 1.1) ? first : null;
  const advice = document.createElement('p');
  advice.className = 'hint';
  advice.textContent =
    winner?.device === 'gpu'
      ? 'The GPU is fastest here, and Auto uses it.'
      : winner?.device === 'server'
        ? 'Your server is fastest here, and Auto uses it (this computer when it can\'t be reached).'
        : winner?.device === 'cpu'
          ? winner.speed >= 1.3
            ? 'The CPU is fastest here and keeps up, so Auto uses it.'
            : 'The CPU is fastest here, but nothing keeps up comfortably: expect short pauses between sentences, or pick a system voice.'
          : first && [first, second].some((r) => r.device === 'server')
            ? 'Your server is about as fast as this computer, so Auto reads here.'
            : first
              ? 'They are about as fast here; either is fine.'
              : 'Nothing could be tested; Supertonic will use the CPU.';
  box.append(advice);
}

function resultRow(name, speed, detail, kind = '') {
  const row = document.createElement('div');
  row.className = 'result';
  row.innerHTML = '<div><strong></strong><div class="detail"></div></div><div class="speed"></div>';
  row.querySelector('strong').textContent = name;
  row.querySelector('.detail').textContent = detail;
  const s = row.querySelector('.speed');
  s.textContent = speed;
  if (kind) s.classList.add(kind);
  return row;
}

$('bench-run').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'reader-benchmark' }));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.supertonicBenchmark) showBenchmark(changes.supertonicBenchmark.newValue);
});

// ── Setup ────────────────────────────────────────────────

function saved() {
  $('status').textContent = 'Saved';
  setTimeout(() => ($('status').textContent = ''), 1200);
}

// Radio buttons for a segmented choice; onPick(value) saves it.
function segmented(container, options, current, onPick) {
  for (const { value, label } of options) {
    const item = document.createElement('label');
    item.innerHTML = '<input type="radio"><span></span>';
    const input = item.querySelector('input');
    input.name = container.id;
    input.value = value;
    input.checked = value === current;
    item.querySelector('span').textContent = label;
    container.append(item);
  }
  container.addEventListener('change', (e) => onPick(e.target.value));
}

async function init() {
  const [prefs, voices, { supertonicBenchmark, serverUrl = '', serverKey = '' }] = await Promise.all([
    chrome.storage.sync.get(['voiceName', 'rate', 'device', 'highlight', 'supertonicSteps']),
    chrome.tts.getVoices(),
    chrome.storage.local.get(['supertonicBenchmark', 'serverUrl', 'serverKey']),
  ]);
  const { voiceName = DEFAULT_VOICE, rate = 1, device = 'auto', highlight = true, supertonicSteps = 4 } = prefs;

  // Only the natural-sounding voices: the system's downloaded Premium/Enhanced voices
  // (macOS) and "Natural" ones (Edge has hundreds), in English or the browser's own
  // languages. The selected voice stays listed whatever it is.
  const langs = new Set(['en', ...navigator.languages.map((l) => l.split('-')[0])]);
  const isNatural = (v) => /\((Premium|Enhanced)\)|Natural/.test(v.voiceName);
  const inMyLanguage = (v) => langs.has(v.lang?.split('-')[0]);
  const byName = (a, b) => a.voiceName.localeCompare(b.voiceName);
  const toItem = (v) => ({ value: v.voiceName, text: `${v.voiceName} (${v.lang ?? '?'})` });
  const shown = voices
    .filter((v) => (isNatural(v) && inMyLanguage(v)) || v.voiceName === voiceName)
    .sort(byName);
  addGroup('Supertonic', SUPERTONIC_VOICES, voiceName);
  addGroup('System voices', shown.filter((v) => !v.remote).map(toItem), voiceName);
  addGroup('Online', shown.filter((v) => v.remote).map(toItem), voiceName);
  showVoiceSettings();

  // Speed: the preset closest to the saved rate (older versions saved e.g. 0.85).
  const closest = SPEEDS.reduce((a, b) => (Math.abs(b.rate - rate) < Math.abs(a.rate - rate) ? b : a));
  segmented($('speed'), SPEEDS.map((s) => ({ value: s.rate, label: s.label })), closest.rate, async (v) => {
    await chrome.storage.sync.set({ rate: Number(v) });
    saved();
  });

  // Supertonic: 4 steps is fast, 16 is the best quality; applies to the next reading.
  const steps = SUPERTONIC_STEPS.includes(Number(supertonicSteps)) ? Number(supertonicSteps) : 4;
  segmented($('steps'), SUPERTONIC_STEPS.map((n) => ({ value: n, label: `${n} steps` })), steps, async (v) => {
    await chrome.storage.sync.set({ supertonicSteps: Number(v) });
    saved();
  });

  for (const input of document.querySelectorAll('#device input')) input.checked = input.value === device;
  showDeviceHint(device);
  $('device').addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ device: e.target.value });
    showDeviceHint(e.target.value);
    if (e.target.value === 'server') $('server').open = true;
    saved();
  });
  showBenchmark(supertonicBenchmark);

  // The server's address and key; open while the server is picked but not set up.
  $('server-url').value = serverUrl;
  $('server-key').value = serverKey;
  $('server').open = device === 'server' && !(serverUrl && serverKey);
  $('server-url').addEventListener('change', async (e) => {
    const url = serverAddress(e.target.value);
    e.target.setCustomValidity(url || !e.target.value.trim() ? '' : 'Enter a web address, like https://tts.example.com');
    if (!e.target.reportValidity()) return;
    e.target.value = url;
    await chrome.storage.local.set({ serverUrl: url });
    saved();
  });
  $('server-key').addEventListener('change', async (e) => {
    await chrome.storage.local.set({ serverKey: e.target.value.trim() });
    saved();
  });

  $('highlight').checked = highlight;
  $('highlight').addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ highlight: e.target.checked });
    saved();
  });
}

select.addEventListener('change', async () => {
  await chrome.storage.sync.set({ voiceName: select.value });
  showVoiceSettings();
  saved();
});

// Played by the background script with the saved settings, so Supertonic voices work here too.
$('test').addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'reader-sample',
    text: 'Hello! This is how I sound when reading your selection.',
  });
});

init();
