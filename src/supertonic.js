// Selection Reader — Supertonic 3 player (runs in the extension's offscreen document).
//
// The fast local engine: four ONNX models and one style file per voice, run with 8 to
// 32 denoising steps. The browser example this is based on (supertonic-helper.js) is MIT;
// the model weights are OpenRAIL-M (see README).
import * as ort from 'onnxruntime-web';
import { loadTextToSpeech, loadVoiceStyle, writeWavFile } from './supertonic-helper.js';
import { modelFile } from './models.js';
const VOICES = new Set(['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5']);
// The popup picks. More steps sound cleaner but take longer, in proportion: on an M5,
// 8 steps is ~22x real time on the GPU and ~2x on the CPU, so above 8 needs the GPU.
const STEPS = new Set([8, 16, 24, 32]);
const DEFAULT_STEPS = 8;

// The ONNX runtime's wasm ships inside the extension (extensions can't load code from
// a CDN). CPU threads: the runtime's default (up to 4) leaves speed on the table, and
// 8 measured faster on both an i7-6700 and an M5, so use the cores each machine has.
ort.env.wasm.wasmPaths = chrome.runtime.getURL('vendor/ort/');
export const cpuThreads = Math.min(8, navigator.hardwareConcurrency || 4);
ort.env.wasm.numThreads = cpuThreads;

// backend: 'webgpu' (GPU) or 'wasm' (CPU), chosen by backendFor in offscreen.js.
// One copy of the models is kept loaded; switching backend loads them again.
let loaded = null; // { backend, promise }
const styles = new Map();

const release = (tts) =>
  Promise.all([tts.dpOrt, tts.textEncOrt, tts.vectorEstOrt, tts.vocoderOrt].map((session) => session.release()));

export function loadSupertonic(backend = 'wasm') {
  if (loaded?.backend === backend) return loaded.promise;
  const previous = loaded;
  const promise = (async () => {
    await previous?.promise.then(release).catch(() => {});
    const { textToSpeech } = await loadTextToSpeech(modelFile, {
      executionProviders: [backend],
      graphOptimizationLevel: 'all',
    });
    console.info('[Selection Reader] Supertonic ready on', backend);
    return textToSpeech;
  })();
  loaded = { backend, promise };
  promise.catch(() => loaded?.promise === promise && (loaded = null)); // let a later attempt retry
  return promise;
}

function loadStyle(voice) {
  if (!VOICES.has(voice)) return Promise.reject(new Error(`Unknown Supertonic voice: ${voice}`));
  let promise = styles.get(voice);
  if (!promise) {
    promise = loadVoiceStyle([`voice_styles/${voice}.json`], false, modelFile);
    promise.catch(() => styles.delete(voice));
    styles.set(voice, promise);
  }
  return promise;
}

// text is one chunk; background.js keeps these under the helper's 300-character split
// (120 for Japanese and Korean). speed: the speaking pace (0.9 is slower, 1.1 faster);
// the model times the speech itself, so it sounds natural rather than stretched.
// lang: one of the helper's AVAILABLE_LANGS, e.g. 'en', 'ja', or 'na' (any language).
export async function speakSupertonic(text, voice, steps = DEFAULT_STEPS, backend = 'wasm', speed = 1, lang = 'en') {
  const [tts, style] = await Promise.all([loadSupertonic(backend), loadStyle(voice)]);
  const totalSteps = STEPS.has(Number(steps)) ? Number(steps) : DEFAULT_STEPS;
  const { wav, duration } = await tts.call(text, lang, style, totalSteps, speed);
  const length = Math.min(wav.length, Math.floor(tts.sampleRate * duration[0]));
  const samples = Float32Array.from(wav.slice(0, length));
  const blob = new Blob([writeWavFile(samples, tts.sampleRate)], { type: 'audio/wav' });
  return { blob, samples, sampleRate: tts.sampleRate };
}
