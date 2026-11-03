// Selection Reader — Supertonic 3 player (runs in the extension's offscreen document).
//
// The fast local engine: four ONNX models and one style file per voice, run with four
// denoising steps. The browser example this is based on (supertonic-helper.js) is MIT;
// the model weights are OpenRAIL-M (see README).
import * as ort from 'onnxruntime-web';
import { loadTextToSpeech, loadVoiceStyle, writeWavFile } from './supertonic-helper.js';

const ONNX_DIR = chrome.runtime.getURL('models/supertonic/onnx');
const VOICE_DIR = chrome.runtime.getURL('models/supertonic/voice_styles');
const VOICES = new Set(['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5']);
const STEPS = new Set([4, 6, 8]); // 4 is the fastest; 8 sounds best, the popup picks
const DEFAULT_STEPS = 4;

// Shares the ONNX runtime (with its WebGPU backend), wasm files and CPU thread
// setting with the Kokoro player.
ort.env.wasm.wasmPaths = chrome.runtime.getURL('vendor/ort/');
ort.env.wasm.numThreads = Math.min(8, navigator.hardwareConcurrency || 4);

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
    const { textToSpeech } = await loadTextToSpeech(ONNX_DIR, {
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
    promise = loadVoiceStyle([`${VOICE_DIR}/${voice}.json`], false);
    promise.catch(() => styles.delete(voice));
    styles.set(voice, promise);
  }
  return promise;
}

// text is one chunk; background.js keeps these under the helper's 300-character split.
export async function speakSupertonic(text, voice, steps = DEFAULT_STEPS, backend = 'wasm') {
  const [tts, style] = await Promise.all([loadSupertonic(backend), loadStyle(voice)]);
  const totalSteps = STEPS.has(Number(steps)) ? Number(steps) : DEFAULT_STEPS;
  const { wav, duration } = await tts.call(text, 'en', style, totalSteps, 1);
  const length = Math.min(wav.length, Math.floor(tts.sampleRate * duration[0]));
  const samples = Float32Array.from(wav.slice(0, length));
  const blob = new Blob([writeWavFile(samples, tts.sampleRate)], { type: 'audio/wav' });
  return { blob, samples, sampleRate: tts.sampleRate };
}
