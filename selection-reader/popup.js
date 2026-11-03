// Selection Reader — popup: voice, speed, where Kokoro runs (with a speed test),
// and word highlighting. Everything is saved to chrome.storage.sync as soon as it
// changes; background.js reads it when reading starts.

const DEFAULT_VOICE = 'kokoro:af_bella'; // keep in step with background.js
// Keep in step with SPEEDS in background.js.
const SPEEDS = [
  { label: 'Slow', rate: 0.9 },
  { label: 'Normal', rate: 1 },
  { label: 'Fast', rate: 1.1 },
];
const $ = (id) => document.getElementById(id);
const select = $('voice');
const hint = $('hint');

// Kokoro's better-rated English voices (grades A to C in kokoro-js); value is the
// voice name background.js expects.
const KOKORO_VOICES = [
  ['af_heart', 'Heart', 'US'], ['af_bella', 'Bella', 'US'], ['af_nicole', 'Nicole', 'US'],
  ['af_aoede', 'Aoede', 'US'], ['af_kore', 'Kore', 'US'], ['af_sarah', 'Sarah', 'US'],
  ['af_nova', 'Nova', 'US'], ['af_alloy', 'Alloy', 'US'], ['am_fenrir', 'Fenrir', 'US'],
  ['am_michael', 'Michael', 'US'], ['am_puck', 'Puck', 'US'], ['bf_emma', 'Emma', 'UK'],
  ['bf_isabella', 'Isabella', 'UK'], ['bm_george', 'George', 'UK'], ['bm_fable', 'Fable', 'UK'],
].map(([id, name, accent]) => ({ id, value: `kokoro:${id}`, text: `${name} (${accent})` }));

const isKokoro = () => select.value.startsWith('kokoro:');

// ── Voice ────────────────────────────────────────────────

// What Kokoro has on this computer: the shared model (~330 MB) and a small file per
// voice, either bundled in the extension by `npm run build` (models/bundled.json) or
// downloaded into the caches the offscreen player fills (same extension origin).
async function kokoroDownloads() {
  const bundled = await fetch('models/bundled.json').then((r) => r.json()).catch(() => null);
  try {
    const urls = async (name) => (await (await caches.open(name)).keys()).map((r) => r.url);
    const [model, voices] = await Promise.all([urls('transformers-cache'), urls('kokoro-voices')]);
    return {
      hasModel: !!bundled || model.some((u) => /\/onnx\/model(_quantized)?\.onnx$/.test(u)),
      voices: new Set([
        ...(bundled?.voices ?? []),
        ...voices.map((u) => u.match(/\/voices\/(\w+)\.bin$/)?.[1]),
      ]),
    };
  } catch {
    return { hasModel: !!bundled, voices: new Set(bundled?.voices) };
  }
}

// Mark the Kokoro voices that are ready to use offline, and explain the rest.
async function showKokoroDownloads() {
  const { hasModel, voices } = await kokoroDownloads();
  for (const v of KOKORO_VOICES) {
    const option = select.querySelector(`option[value="${v.value}"]`);
    if (option) option.text = hasModel && voices.has(v.id) ? `${v.text}  ✓ downloaded` : v.text;
  }
  hint.textContent = hasModel
    ? 'Runs on your computer. Voices marked ✓ work offline; the others download a small file (under 1 MB) the first time.'
    : 'Runs on your computer. The first time, it downloads the voice model (about 330 MB) and takes a few seconds to start; after that it works offline.';
}

// items: [{ value, text }]
function addGroup(label, items, current) {
  if (!items.length) return;
  const group = document.createElement('optgroup');
  group.label = label;
  for (const { value, text } of items) group.append(new Option(text, value, false, value === current));
  select.append(group);
}

function showKokoroSettings() {
  hint.hidden = !isKokoro();
  $('kokoro').hidden = !isKokoro();
}

// ── Kokoro device and speed test ─────────────────────────

const DEVICE_HINTS = {
  auto: 'Uses the graphics card when there is a suitable one, otherwise the processor.',
  gpu: 'Always uses the graphics card (WebGPU). Fastest when the computer has a real one.',
  cpu: 'Uses the processor only. Works everywhere; slower, and busier on laptops.',
};

function showDeviceHint(device) {
  $('device-hint').textContent = DEVICE_HINTS[device];
}

// state: { state: 'running', device } or { state: 'done', results, at }, from
// chrome.storage.local (background.js keeps it there so it survives closing the popup).
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
    box.append(resultRow(bench.device === 'gpu' ? 'GPU' : 'CPU', 'Testing…', ''));
    return;
  }
  for (const r of bench.results) {
    const name = r.device === 'gpu' ? 'GPU' : 'CPU';
    if (!r.available) {
      box.append(resultRow(name, 'Not available', r.error ?? ''));
      continue;
    }
    const detail = `ready in ${(r.loadMs / 1000).toFixed(1)} s, first sentence ${(r.firstMs / 1000).toFixed(1)} s`;
    box.append(resultRow(name, `${r.speed}× real time`, detail, r.speed >= 1.3 ? 'ok' : 'slow'));
  }
  const [gpu, cpu] = ['gpu', 'cpu'].map((d) => bench.results.find((r) => r.device === d && r.available));
  const advice = document.createElement('p');
  advice.className = 'hint';
  advice.textContent =
    gpu && (!cpu || gpu.speed >= cpu.speed)
      ? 'The GPU is faster here, so Auto or GPU is the best choice.'
      : cpu && cpu.speed >= 1.3
        ? 'The CPU keeps up here, so CPU or Auto is a good choice.'
        : 'Neither keeps up comfortably here: expect short pauses between sentences, or pick a system voice.';
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
  if (area === 'local' && changes.benchmark) showBenchmark(changes.benchmark.newValue);
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
  const [prefs, voices, { benchmark }] = await Promise.all([
    chrome.storage.sync.get(['voiceName', 'rate', 'device', 'highlight']),
    chrome.tts.getVoices(),
    chrome.storage.local.get('benchmark'),
  ]);
  const { voiceName = DEFAULT_VOICE, rate = 1, device = 'auto', highlight = true } = prefs;

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
  addGroup('Kokoro (runs on this computer)', KOKORO_VOICES, voiceName);
  addGroup('System voices', shown.filter((v) => !v.remote).map(toItem), voiceName);
  addGroup('Online', shown.filter((v) => v.remote).map(toItem), voiceName);
  showKokoroSettings();
  showKokoroDownloads();

  // Speed: the preset closest to the saved rate (older versions saved e.g. 0.85).
  const closest = SPEEDS.reduce((a, b) => (Math.abs(b.rate - rate) < Math.abs(a.rate - rate) ? b : a));
  segmented($('speed'), SPEEDS.map((s) => ({ value: s.rate, label: s.label })), closest.rate, async (v) => {
    await chrome.storage.sync.set({ rate: Number(v) });
    saved();
  });

  for (const input of document.querySelectorAll('#device input')) input.checked = input.value === device;
  showDeviceHint(device);
  $('device').addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ device: e.target.value });
    showDeviceHint(e.target.value);
    saved();
  });
  showBenchmark(benchmark);

  $('highlight').checked = highlight;
  $('highlight').addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ highlight: e.target.checked });
    saved();
  });
}

// A Kokoro sentence starting means its model and voice are now downloaded.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'kokoro-event' && msg.event === 'start') showKokoroDownloads();
});

select.addEventListener('change', async () => {
  await chrome.storage.sync.set({ voiceName: select.value });
  showKokoroSettings();
  saved();
});

// Played by the background script with the saved settings, so Kokoro voices work here too.
$('test').addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'reader-sample',
    text: 'Hello! This is how I sound when reading your selection.',
  });
});

init();
