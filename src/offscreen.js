// Selection Reader — local voice player (runs in the extension's offscreen document).
//
// The background script can't play audio or run the model, so it sends this page
// the sentences to read. Each one is turned into audio with the local Supertonic
// model (supertonic.js), or by the user's own Supertonic server (server.js), while the
// previous one plays. Built into selection-reader/offscreen.js by `npm run build`.
import { loadSupertonic, speakSupertonic, cpuThreads } from './supertonic.js';
import { speakServer, warmServer } from './server.js';

const post = (msg) => chrome.runtime.sendMessage({ type: 'voice-event', ...msg }).catch(() => {});

// ── Model ────────────────────────────────────────────────
// device: 'gpu' (WebGPU), 'cpu' (WebAssembly, multi-threaded since the page is
// cross-origin isolated, see manifest.json), 'auto', or 'server' (see synthesize).
// Auto skips "fallback" adapters (software rendering, e.g. a PC without a graphics
// driver), which are slower than the CPU path; 'gpu' uses any adapter. Without one,
// both use the CPU.
const gpuAdapter = async () => (await navigator.gpu?.requestAdapter().catch(() => null)) ?? null;

// The ONNX runtime backend a device setting means: 'webgpu' or 'wasm'.
async function backendFor(device) {
  const adapter = device === 'cpu' ? null : await gpuAdapter();
  return adapter && (device === 'gpu' || !adapter.info?.isFallbackAdapter) ? 'webgpu' : 'wasm';
}

// One model run at a time: generations (and the benchmark) can't run in parallel.
let queue = Promise.resolve();
function enqueue(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}

// The model speaks at the reading speed itself (speed: the pace the sentence was
// made at), which sounds more natural than speeding up or slowing down the audio.
// The speed is read when the sentence is made, so a change applies from there on.
function generate(job, i) {
  return enqueue(async () => {
    if (job.cancelled) return null;
    const speed = job.rate;
    const made = await synthesize(job, job.chunks[i], speed);
    if (!made) return null;
    const { blob, samples, sampleRate } = made;
    return {
      blob,
      wordStarts: estimateWordStarts(job.chunks[i], { audio: samples, sampling_rate: sampleRate }),
      speed,
    };
  });
}

// One sentence from the user's server (job.server, when the device is 'server'), or
// from the local model. If the server fails (offline, wrong key…), the rest of the
// reading is made here, so a dead server doesn't hold up every sentence.
async function synthesize(job, text, speed) {
  if (job.server && !job.serverFailed) {
    try {
      return await speakServer(job.server, text, job.voice, job.steps, speed, job.abort.signal);
    } catch (err) {
      if (job.cancelled) return null;
      console.warn('[Selection Reader] Supertonic server failed, reading on this computer:', err.message);
      job.serverFailed = true;
    }
  }
  return speakSupertonic(text, job.voice, job.steps, await backendFor(job.server ? 'auto' : job.device), speed);
}

// The model doesn't say when each word is spoken, so estimate it: spread the words
// over the part of the audio that isn't silence, in proportion to their length,
// with extra room for the pause after a comma or full stop. Returns each word's
// start time in seconds (media time, so it holds at any playback speed).
function estimateWordStarts(text, { audio: samples, sampling_rate: rate }) {
  const loud = (x) => Math.abs(x) > 0.02;
  let first = samples.findIndex(loud);
  let last = samples.findLastIndex(loud);
  if (first < 0) [first, last] = [0, samples.length - 1];
  const words = text.split(' ');
  const weights = words.map(
    (w) => w.replace(/[^\p{L}\p{N}]/gu, '').length + 2 + (/[,;:]$/.test(w) ? 4 : /[.!?]$/.test(w) ? 6 : 0),
  );
  const total = weights.reduce((a, b) => a + b, 0);
  const span = (last - first) / rate;
  let before = 0;
  return weights.map((w) => {
    const start = first / rate + (before / total) * span;
    before += w;
    return start;
  });
}

// ── Playback ─────────────────────────────────────────────
// job: { id, chunks, voice, rate, device, steps, server, paused, cancelled, abort,
//   serverFailed, sentenceSpeed }; abort cancels a server request in flight.
let current = null;
let audio = null;

async function play(job, start) {
  post({ id: job.id, event: 'loading' });
  let next = generate(job, start);
  for (let i = start; i < job.chunks.length; i++) {
    let sentence;
    try {
      sentence = await next;
    } catch (err) {
      if (!job.cancelled) post({ id: job.id, event: 'error', message: String(err?.message ?? err) });
      return;
    }
    if (job.cancelled) return;
    if (i + 1 < job.chunks.length) next = generate(job, i + 1); // prepare the next sentence meanwhile
    post({ id: job.id, event: 'start', index: i });
    await playSentence(job, i, sentence);
    if (job.cancelled) return;
  }
  post({ id: job.id, event: 'end' });
}

function playSentence(job, index, { blob, wordStarts, speed }) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    audio = new Audio(url);
    // Normally 1. If the speed changed after this sentence was made, the audio is sped
    // up or slowed down (keeping the pitch) until the next sentence, made at the new speed.
    job.sentenceSpeed = speed;
    audio.playbackRate = job.rate / speed;
    const sentenceAudio = audio;

    // Report each word as playback reaches it (the page highlights it).
    let word = -1;
    const tracker = setInterval(() => {
      const t = sentenceAudio.currentTime;
      let w = word;
      while (w + 1 < wordStarts.length && wordStarts[w + 1] <= t) w++;
      if (w !== word && w >= 0) post({ id: job.id, event: 'word', index, word: (word = w) });
    }, 40);

    const done = () => {
      clearInterval(tracker);
      URL.revokeObjectURL(url);
      job.finishSentence = null;
      resolve();
    };
    audio.addEventListener('ended', done, { once: true });
    job.finishSentence = done; // lets stop() end the wait
    if (!job.paused) startAudio(done);
  });
}

// Pausing while play() is still starting rejects it with an AbortError; that
// isn't the end of the sentence, so only give up on real playback errors.
function startAudio(onFail) {
  audio?.play().catch((err) => {
    if (err.name !== 'AbortError') onFail?.();
  });
}

function stop() {
  if (current) {
    current.cancelled = true;
    current.abort.abort();
    current.finishSentence?.();
  }
  audio?.pause();
  audio = null;
  current = null;
}

// ── Benchmark ────────────────────────────────────────────
// Times loading the model and reading a sentence on each device, at the given
// number of steps; for the server, the whole round trip. `speed` is how many seconds
// of speech are made per second (above 1 keeps up with playback).
const BENCHMARK_TEXT =
  'The quick brown fox jumps over the lazy dog, then it runs back into the forest to rest for the night.';

function benchmark(runs, steps, server) {
  return enqueue(async () => {
    const results = [];
    for (const { device } of runs) {
      chrome.runtime.sendMessage({ type: 'voice-benchmark', state: 'running', device }).catch(() => {});
      try {
        if (device === 'gpu' && !(await gpuAdapter())) {
          results.push({ device, available: false, error: 'No WebGPU-capable GPU' });
          continue;
        }
        const backend = device === 'server' ? null : await backendFor(device);
        const say = backend
          ? () => speakSupertonic(BENCHMARK_TEXT, 'F1', steps, backend)
          : () => speakServer(server, BENCHMARK_TEXT, 'F1', steps);
        let t = performance.now();
        await (backend ? loadSupertonic(backend) : warmServer(server));
        const loadMs = performance.now() - t;
        t = performance.now();
        await say(); // first run includes warm-up
        const firstMs = performance.now() - t;
        t = performance.now();
        const { samples, sampleRate } = await say();
        const ms = performance.now() - t;
        results.push({
          device, steps, available: true,
          loadMs: Math.round(loadMs), firstMs: Math.round(firstMs), ms: Math.round(ms),
          speed: +(samples.length / sampleRate / (ms / 1000)).toFixed(1),
          threads: device === 'cpu' ? cpuThreads : undefined,
        });
      } catch (err) {
        results.push({ device, available: false, error: String(err?.message ?? err) });
      }
    }
    chrome.runtime.sendMessage({ type: 'voice-benchmark', state: 'done', results, at: Date.now() }).catch(() => {});
    return results;
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;
  switch (msg.type) {
    case 'load':
      if (msg.server) warmServer(msg.server);
      else enqueue(async () => loadSupertonic(await backendFor(msg.device))).catch(() => {});
      break;
    case 'speak':
      stop();
      current = {
        id: msg.id, chunks: msg.chunks, voice: msg.voice, rate: msg.rate, device: msg.device,
        steps: msg.steps, server: msg.server, paused: false, abort: new AbortController(),
      };
      play(current, msg.start ?? 0);
      break;
    case 'pause':
      if (current) current.paused = true;
      audio?.pause();
      break;
    case 'resume':
      if (current) current.paused = false;
      startAudio(current?.finishSentence);
      break;
    case 'rate':
      if (current) current.rate = msg.rate;
      if (audio) audio.playbackRate = msg.rate / (current?.sentenceSpeed ?? 1);
      break;
    case 'stop':
      stop();
      break;
    case 'benchmark':
      benchmark(msg.runs ?? [{ device: 'gpu' }, { device: 'cpu' }], msg.steps, msg.server);
      break;
  }
});
