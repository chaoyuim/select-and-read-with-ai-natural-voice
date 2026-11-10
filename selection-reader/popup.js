// Selection Reader — popup: voice, speed, Supertonic's quality and where it runs
// (with a speed test and the user's own server), word highlighting, and the sites that
// show the Read button. Everything is saved to chrome.storage.sync as soon as it changes
// (the server's address and key to chrome.storage.local); background.js reads it when
// reading starts, page.js for the Read button.

const DEFAULT_VOICE = 'supertonic:F1'; // keep in step with background.js
// Keep in step with SPEEDS in background.js.
const SPEEDS = [
  { label: 'Slow', rate: 0.9 },
  { label: 'Normal', rate: 1 },
  { label: 'Fast', rate: 1.1 },
];
const $ = (id) => document.getElementById(id);
const select = $('voice');

// Supertonic 3's ten preset voices (F1-F5 female, M1-M5 male), plus any the build's
// server has that aren't bundled (server-default.json, see background.js).
let SERVER_VOICES = new Set();
const supertonicVoices = () => ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5', ...SERVER_VOICES].map((id) => ({
  id,
  value: `supertonic:${id}`,
  text: `${id} (${id.startsWith('F') || id.includes('FEMALE') ? 'female' : 'male'}${SERVER_VOICES.has(id) ? ', server' : ''})`,
}));

const isSupertonic = () => select.value.startsWith('supertonic:');
const isServerVoice = () => isSupertonic() && SERVER_VOICES.has(select.value.slice('supertonic:'.length));

let devicePref = 'auto'; // the saved device; a server-only voice shows Server instead
let hasServerKey = false; // the server's key, from the popup or the build

// Supertonic 3's languages (keep in step with SUPERTONIC_LANGS in background.js), with
// what Play sample says in each; 'na' is its language-agnostic mode.
const SAMPLES = {
  en: 'Hello! This is how I sound when reading your selection.',
  ar: 'مرحبًا! هكذا يبدو صوتي.',
  bg: 'Здравейте! Ето как звучи гласът ми.',
  cs: 'Dobrý den! Takhle zní můj hlas.',
  da: 'Hej! Sådan lyder min stemme.',
  de: 'Hallo! So klingt meine Stimme.',
  el: 'Γεια σας! Έτσι ακούγεται η φωνή μου.',
  es: '¡Hola! Así suena mi voz.',
  et: 'Tere! Nii kõlab minu hääl.',
  fi: 'Hei! Tältä ääneni kuulostaa.',
  fr: 'Bonjour ! Voici à quoi ressemble ma voix.',
  hi: 'नमस्ते! मेरी आवाज़ ऐसी सुनाई देती है।',
  hr: 'Bok! Ovako zvuči moj glas.',
  hu: 'Szia! Így szól a hangom.',
  id: 'Halo! Beginilah suara saya.',
  it: 'Ciao! Ecco come suona la mia voce.',
  ja: 'こんにちは！これが私の声です。',
  ko: '안녕하세요! 제 목소리는 이렇습니다.',
  lt: 'Labas! Štai kaip skamba mano balsas.',
  lv: 'Sveiki! Lūk, kā skan mana balss.',
  nl: 'Hallo! Zo klinkt mijn stem.',
  pl: 'Cześć! Tak brzmi mój głos.',
  pt: 'Olá! É assim que a minha voz soa.',
  ro: 'Bună! Așa sună vocea mea.',
  ru: 'Здравствуйте! Вот как звучит мой голос.',
  sk: 'Dobrý deň! Takto znie môj hlas.',
  sl: 'Pozdravljeni! Tako zveni moj glas.',
  sv: 'Hej! Så här låter min röst.',
  tr: 'Merhaba! Sesim böyle duyuluyor.',
  uk: 'Привіт! Ось як звучить мій голос.',
  vi: 'Xin chào! Đây là giọng nói của tôi.',
  na: 'Hello! This is how I sound when reading your selection.',
};

// English first, then the rest by name ("Dutch (Nederlands)"), then 'na'.
function fillLanguages(current) {
  const english = new Intl.DisplayNames(['en'], { type: 'language' });
  const name = (code) => {
    const own = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    const en = english.of(code);
    return own && own.toLowerCase() !== en.toLowerCase() ? `${en} (${own})` : en;
  };
  const others = Object.keys(SAMPLES)
    .filter((code) => code !== 'en' && code !== 'na')
    .map((code) => ({ code, text: name(code) }))
    .sort((a, b) => a.text.localeCompare(b.text));
  const items = [{ code: 'en', text: 'English' }, ...others, { code: 'na', text: 'Other or mixed' }];
  for (const { code, text } of items) $('lang').append(new Option(text, code, false, code === current));
}
const SUPERTONIC_STEPS = [8, 16, 24, 32];

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
  for (const id of ['supertonic', 'local', 'hint', 'language']) $(id).hidden = !supertonic;
  showDevice(isServerVoice() ? 'server' : devicePref);
}

// The device radios; a server-only voice can only use the server.
function showDevice(device) {
  const locked = isServerVoice();
  for (const input of document.querySelectorAll('#device input')) {
    input.disabled = locked && input.value !== 'server';
    input.checked = input.value === device;
  }
  showDeviceHint(device);
}

// ── Supertonic: device, server and speed test ────────────

const DEVICE_HINTS = {
  auto: 'Uses whichever your last speed test found fastest (your server too, if set up); before one, the graphics card when there is a suitable one.',
  gpu: 'Always uses the graphics card (WebGPU). Fastest when the computer has a real one.',
  cpu: 'Uses the processor only. Works everywhere; slower, and busier on laptops.',
  server: 'Uses your own Supertonic server, set up below. If it can\'t be reached, Supertonic runs on this computer instead.',
};
const DEVICE_NAMES = { gpu: 'GPU', cpu: 'CPU', server: 'Server' };
const SERVER_VOICE_HINT =
  'This voice is on your Supertonic server only, so it always reads through it. Set the server up below.';

function showDeviceHint(device) {
  $('device-hint').textContent = isServerVoice() ? SERVER_VOICE_HINT : DEVICE_HINTS[device];
  // A server-only voice needs the server's key: ask for it.
  if ((isServerVoice() || device === 'server') && !hasServerKey) $('server').open = true;
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

// ── Read button: sites ───────────────────────────────────

const SITES_HINTS = {
  all: 'The Read button appears when you select text on any site.',
  only: 'The Read button appears only on these sites and their subdomains. Elsewhere, Alt+R and the right-click menu still read.',
};

// A site as typed or taken from a tab ("https://www.Example.com/page", "example.com"):
// its host without "www.", or '' if it isn't one.
function siteName(text) {
  const typed = text.trim().toLowerCase();
  if (!typed) return '';
  try {
    const { hostname } = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(typed) ? typed : `https://${typed}`);
    return /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(hostname) ? hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

let siteList = []; // sorted, e.g. ["skilljar.com"]
let thisSite = ''; // the current tab's site, when the popup can see it (activeTab)

async function saveSites(list) {
  siteList = [...new Set(list)].sort();
  await chrome.storage.sync.set({ buttonSiteList: siteList });
  showSites();
  saved();
}

function showSites() {
  const items = siteList.map((site) => {
    const item = document.createElement('li');
    item.innerHTML = '<span></span><button type="button">Remove</button>';
    item.querySelector('span').textContent = site;
    const remove = item.querySelector('button');
    remove.setAttribute('aria-label', `Remove ${site}`);
    remove.addEventListener('click', () => saveSites(siteList.filter((s) => s !== site)));
    return item;
  });
  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No sites yet, so the Read button shows nowhere.';
    items.push(empty);
  }
  $('site-list').replaceChildren(...items);
  const listed = siteList.some((d) => thisSite === d || thisSite.endsWith(`.${d}`));
  $('site-this').hidden = !thisSite || listed;
  $('site-this').textContent = `Add this site (${thisSite})`;
}

function showSitesMode(mode) {
  $('sites').hidden = mode !== 'only';
  $('sites-hint').textContent = SITES_HINTS[mode];
}

function addTypedSite() {
  const input = $('site-input');
  const site = siteName(input.value);
  input.setCustomValidity(site ? '' : 'Enter a site, like example.com');
  if (!input.reportValidity()) return;
  input.value = '';
  saveSites([...siteList, site]);
}

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
  const [prefs, voices, { supertonicBenchmark, serverUrl, serverKey }, defaults] = await Promise.all([
    chrome.storage.sync.get([
      'voiceName', 'rate', 'device', 'highlight', 'supertonicSteps', 'supertonicLang', 'buttonSites', 'buttonSiteList',
    ]),
    chrome.tts.getVoices(),
    chrome.storage.local.get(['supertonicBenchmark', 'serverUrl', 'serverKey']),
    // The build's server, if any (see background.js).
    fetch('server-default.json').then((r) => r.json(), () => ({})),
  ]);
  const { url: defaultUrl = '', key: defaultKey = '', voices: serverVoices = [] } = defaults;
  SERVER_VOICES = new Set(serverVoices);
  const {
    voiceName = DEFAULT_VOICE, rate = 1, device = 'auto', highlight = true, supertonicSteps = 8, supertonicLang = 'en',
    buttonSites = 'all', buttonSiteList = [],
  } = prefs;
  devicePref = device;
  hasServerKey = !!(serverKey || defaultKey);

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
  addGroup('Supertonic', supertonicVoices(), voiceName);
  addGroup('System voices', shown.filter((v) => !v.remote).map(toItem), voiceName);
  addGroup('Online', shown.filter((v) => v.remote).map(toItem), voiceName);
  showVoiceSettings();

  // Speed: the preset closest to the saved rate (older versions saved e.g. 0.85).
  const closest = SPEEDS.reduce((a, b) => (Math.abs(b.rate - rate) < Math.abs(a.rate - rate) ? b : a));
  segmented($('speed'), SPEEDS.map((s) => ({ value: s.rate, label: s.label })), closest.rate, async (v) => {
    await chrome.storage.sync.set({ rate: Number(v) });
    saved();
  });

  // Supertonic's language; applies to the next reading.
  fillLanguages(supertonicLang in SAMPLES ? supertonicLang : 'en');
  $('lang').addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ supertonicLang: e.target.value });
    saved();
  });

  // Supertonic: 8 steps, up to 32 for the best quality; applies to the next reading.
  const steps = SUPERTONIC_STEPS.includes(Number(supertonicSteps)) ? Number(supertonicSteps) : 8;
  segmented($('steps'), SUPERTONIC_STEPS.map((n) => ({ value: n, label: `${n} steps` })), steps, async (v) => {
    await chrome.storage.sync.set({ supertonicSteps: Number(v) });
    saved();
  });

  showDevice(isServerVoice() ? 'server' : devicePref);
  $('device').addEventListener('change', async (e) => {
    devicePref = e.target.value;
    await chrome.storage.sync.set({ device: devicePref });
    showDeviceHint(devicePref);
    if (devicePref === 'server') $('server').open = true;
    saved();
  });
  showBenchmark(supertonicBenchmark);

  // The server's address and key, or the defaults; open while the server is picked
  // but has no key. Emptying a field goes back to its default, which isn't stored, so
  // a new default in a later version applies.
  $('server-url').value = serverUrl || defaultUrl;
  $('server-key').value = serverKey || defaultKey;
  const saveOrDefault = async (name, value, fallback) => {
    if (value && value !== fallback) await chrome.storage.local.set({ [name]: value });
    else await chrome.storage.local.remove(name);
    saved();
  };
  $('server-url').addEventListener('change', async (e) => {
    const typed = e.target.value.trim();
    const url = typed ? serverAddress(typed) : defaultUrl;
    e.target.setCustomValidity(url || !typed ? '' : 'Enter a web address, like https://tts.example.com');
    if (!e.target.reportValidity()) return;
    e.target.value = url;
    await saveOrDefault('serverUrl', url, defaultUrl);
  });
  $('server-key').addEventListener('change', async (e) => {
    const key = e.target.value.trim() || defaultKey;
    e.target.value = key;
    hasServerKey = !!key;
    await saveOrDefault('serverKey', key, defaultKey);
  });

  $('highlight').checked = highlight;
  $('highlight').addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ highlight: e.target.checked });
    saved();
  });

  // Read button: every site, or only the listed ones. Opening the popup from the
  // toolbar lets it see the current tab's address (activeTab), for "Add this site".
  for (const input of document.querySelectorAll('#sites-mode input')) input.checked = input.value === buttonSites;
  showSitesMode(buttonSites);
  $('sites-mode').addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ buttonSites: e.target.value });
    showSitesMode(e.target.value);
    saved();
  });
  siteList = [...buttonSiteList].sort();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  thisSite = /^https?:/.test(tab?.url ?? '') ? siteName(tab.url) : '';
  showSites();
  $('site-add').addEventListener('click', addTypedSite);
  $('site-input').addEventListener('keydown', (e) => e.key === 'Enter' && addTypedSite());
  $('site-this').addEventListener('click', () => saveSites([...siteList, thisSite]));
}

select.addEventListener('change', async () => {
  await chrome.storage.sync.set({ voiceName: select.value });
  showVoiceSettings();
  saved();
});

// Played by the background script with the saved settings, so Supertonic voices work
// here too; in the language picked for Supertonic.
$('test').addEventListener('click', () => {
  if (isServerVoice() && !hasServerKey) {
    $('status').textContent = 'Add your server\'s key below';
    $('server').open = true;
    return;
  }
  chrome.runtime.sendMessage({
    type: 'reader-sample',
    text: isSupertonic() ? SAMPLES[$('lang').value] : SAMPLES.en,
  });
});

init();
