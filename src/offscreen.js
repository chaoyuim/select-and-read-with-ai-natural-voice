// Selection Reader — Kokoro player (runs in the extension's offscreen document).
//
// The background script can't play audio or run the model, so it sends this page
// the sentences to read. Each sentence is turned into audio with the local Kokoro
// model while the previous one plays. Built into selection-reader/offscreen.js by
// `npm run build`.
import { KokoroTTS } from 'kokoro-js';
import { env } from '@huggingface/transformers';
import { loadSupertonic, speakSupertonic } from './supertonic.js';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

// The ONNX runtime's wasm ships inside the extension (extensions can't load code from a CDN).
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vendor/ort/');
// CPU threads: the runtime's default (up to 4) leaves speed on the table. 8 threads
// measured ~18% faster than 4 on an i7-6700 (0.87x against 0.74x real time), and on
// an M5 they still helped (2.6x against 2.3x), so use the cores each machine has.
env.backends.onnx.wasm.numThreads = Math.min(8, navigator.hardwareConcurrency || 4);

// The model and some voices may be bundled in the extension's models/ folder by
// `npm run build` ({ model, voices } in bundled.json); otherwise they're downloaded.
const bundled = fetch(chrome.runtime.getURL('models/bundled.json'))
  .then((r) => r.json())
  .catch(() => null);

// Both local engines report through this message (background.js keeps the name).
const post = (msg) => chrome.runtime.sendMessage({ type: 'kokoro-event', ...msg }).catch(() => {});

// ── Model ────────────────────────────────────────────────
// device: 'gpu' (WebGPU), 'cpu' (WebAssembly, multi-threaded since the page is
// cross-origin isolated, see manifest.json) or 'auto'. Auto skips "fallback"
// adapters (software rendering, e.g. a PC without a graphics driver), which are
// slower than the CPU path; 'gpu' uses any adapter. Without one, both use the CPU.
// Only one model is kept loaded; switching device loads it again.
let loaded = null; // { key, promise }

const gpuAdapter = async () => (await navigator.gpu?.requestAdapter().catch(() => null)) ?? null;

async function resolveDevice(device, dtype) {
  const adapter = device === 'cpu' ? null : await gpuAdapter();
  const useGpu = adapter && (device === 'gpu' || !adapter.info?.isFallbackAdapter);
  return { device: useGpu ? 'webgpu' : 'wasm', dtype: dtype ?? 'fp32' };
}

async function loadModel(device = 'auto', id, dtype) {
  const options = await resolveDevice(device, dtype);
  const key = `${options.device}/${options.dtype}`;
  if (loaded?.key === key) return loaded.promise;

  const previous = loaded;
  const promise = (async () => {
    await previous?.promise.then((tts) => tts.model.dispose()).catch(() => {});
    const local = await bundled;
    if (local) {
      env.allowLocalModels = true;
      env.localModelPath = chrome.runtime.getURL('models/');
      // Read straight from the extension's files: no 325 MB copy in the browser cache,
      // and drop the copy downloaded before the model was bundled.
      env.useBrowserCache = false;
      caches.delete('transformers-cache');
    }
    let lastPercent = null;
    const tts = await KokoroTTS.from_pretrained(MODEL, {
      ...options,
      progress_callback: (p) => {
        // Only downloads of the model weights are worth reporting; the config files
        // are tiny, and reading the bundled model takes a moment.
        if (local || p.status !== 'progress' || !(p.total > 1e6)) return;
        const percent = Math.floor((p.loaded / p.total) * 100);
        if (percent === lastPercent) return;
        lastPercent = percent;
        post({ id: current?.id ?? id, event: 'progress', percent });
      },
    });
    console.info('[Selection Reader] Kokoro ready on', key);
    return tts;
  })();
  loaded = { key, promise };
  promise.catch(() => loaded?.promise === promise && (loaded = null)); // let a later attempt retry
  return promise;
}

// kokoro-js always fetches voices from Hugging Face through its own cache, so a
// bundled voice is put in that cache under the address kokoro-js asks for.
const seededVoices = new Set();
async function useBundledVoice(voice) {
  const local = await bundled;
  if (!local?.voices.includes(voice) || seededVoices.has(voice)) return;
  const url = `https://huggingface.co/${local.model}/resolve/main/voices/${voice}.bin`;
  const cache = await caches.open('kokoro-voices');
  if (!(await cache.match(url))) {
    await cache.put(url, await fetch(chrome.runtime.getURL(`models/${local.model}/voices/${voice}.bin`)));
  }
  seededVoices.add(voice);
}

// One model run at a time: generations (and the benchmark) can't run in parallel.
let queue = Promise.resolve();
function enqueue(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}

function generateKokoro(job, i) {
  return enqueue(async () => {
    if (job.cancelled) return null;
    const tts = await loadModel(job.device, job.id);
    await useBundledVoice(job.voice);
    const audio = await tts.generate(job.chunks[i], { voice: job.voice });
    return { blob: audio.toBlob(), wordStarts: estimateWordStarts(job.chunks[i], audio) };
  });
}

function generateSupertonic(job, i) {
  return enqueue(async () => {
    if (job.cancelled) return null;
    const { blob, samples, sampleRate } = await speakSupertonic(job.chunks[i], job.voice, job.steps);
    return {
      blob,
      wordStarts: estimateWordStarts(job.chunks[i], { audio: samples, sampling_rate: sampleRate }),
    };
  });
}

function generate(job, i) {
  return job.engine === 'supertonic' ? generateSupertonic(job, i) : generateKokoro(job, i);
}

// Kokoro doesn't say when each word is spoken, so estimate it: spread the words
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
// job: { id, chunks, voice, rate, device, paused, cancelled }
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

function playSentence(job, index, { blob, wordStarts }) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    audio = new Audio(url);
    audio.playbackRate = job.rate; // speeds up without changing pitch
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
    current.finishSentence?.();
  }
  audio?.pause();
  audio = null;
  current = null;
}

// ── Benchmark ────────────────────────────────────────────
// Times loading the model and reading a sentence on each device. `speed` is how
// many seconds of speech are made per second (above 1 keeps up with playback).
// A run can name a dtype to compare model variants (fp32 measured faster than q8
// on the CPU here too: 0.87x against 0.45x real time on an i7-6700).
const BENCHMARK_TEXT =
  'The quick brown fox jumps over the lazy dog, then it runs back into the forest to rest for the night.';

function benchmark(runs) {
  return enqueue(async () => {
    const results = [];
    for (const { device, dtype } of runs) {
      const postBench = (state, extra) => chrome.runtime.sendMessage({ type: 'kokoro-benchmark', state, device, ...extra }).catch(() => {});
      postBench('running');
      try {
        if (device === 'gpu' && !(await gpuAdapter())) {
          results.push({ device, available: false, error: 'No WebGPU-capable GPU' });
          continue;
        }
        const voice = (await bundled)?.voices[0] ?? 'af_heart';
        await useBundledVoice(voice);
        let t = performance.now();
        const tts = await loadModel(device, undefined, dtype);
        const loadMs = performance.now() - t;
        t = performance.now();
        await tts.generate(BENCHMARK_TEXT, { voice }); // first run includes warm-up
        const firstMs = performance.now() - t;
        t = performance.now();
        const out = await tts.generate(BENCHMARK_TEXT, { voice });
        const ms = performance.now() - t;
        const seconds = out.audio.length / out.sampling_rate;
        results.push({
          device, dtype: dtype ?? 'fp32', available: true, loadMs: Math.round(loadMs),
          firstMs: Math.round(firstMs), ms: Math.round(ms), speed: +(seconds / (ms / 1000)).toFixed(1),
          threads: device === 'cpu' ? env.backends.onnx.wasm.numThreads : undefined,
        });
      } catch (err) {
        results.push({ device, available: false, error: String(err?.message ?? err) });
      }
    }
    chrome.runtime.sendMessage({ type: 'kokoro-benchmark', state: 'done', results, at: Date.now() }).catch(() => {});
    return results;
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;
  switch (msg.type) {
    case 'load':
      enqueue(() => loadModel(msg.device, msg.id)).catch(() => {});
      break;
    case 'load-supertonic':
      enqueue(() => loadSupertonic()).catch(() => {});
      break;
    case 'speak':
      stop();
      current = {
        id: msg.id, chunks: msg.chunks, voice: msg.voice, rate: msg.rate, device: msg.device,
        paused: false, engine: 'kokoro',
      };
      play(current, msg.start ?? 0);
      break;
    case 'supertonic-speak':
      stop();
      current = {
        id: msg.id, chunks: msg.chunks, voice: msg.voice, rate: msg.rate, device: msg.device,
        steps: msg.steps, paused: false, engine: 'supertonic',
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
      if (audio) audio.playbackRate = msg.rate;
      break;
    case 'stop':
      stop();
      break;
    case 'benchmark':
      benchmark(msg.runs ?? [{ device: 'gpu' }, { device: 'cpu' }]);
      break;
  }
});
