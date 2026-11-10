// Selection Reader — where the Supertonic 3 model files come from.
//
// A personal build (`npm run build`) bundles them in selection-reader/models/supertonic.
// The store build (`npm run build:store`) leaves them out to stay small (~400 MB less):
// they're downloaded once from Hugging Face, at a fixed revision, the first time the
// voice runs on this computer, and kept in the extension's Cache Storage. Removing the
// extension removes them too.

export const MODEL_REPO = 'Supertone/supertonic-3';
export const MODEL_REVISION = '3cadd1ee6394adea1bd021217a0e650ede09a323'; // keep in step with build.mjs
const CACHE = `supertonic-3-${MODEL_REVISION.slice(0, 8)}`;

// Every file the voice needs, with its size in bytes (for download progress).
export const MODEL_FILES = {
  'onnx/tts.json': 8253,
  'onnx/unicode_indexer.json': 277676,
  'onnx/duration_predictor.onnx': 3700147,
  'onnx/text_encoder.onnx': 36416150,
  'onnx/vector_estimator.onnx': 256534781,
  'onnx/vocoder.onnx': 101424195,
  ...Object.fromEntries(
    [
      ['F1', 292046], ['F2', 292423], ['F3', 290794], ['F4', 291808], ['F5', 291479],
      ['M1', 291748], ['M2', 292055], ['M3', 290198], ['M4', 291522], ['M5', 291469],
    ].map(([voice, size]) => [`voice_styles/${voice}.json`, size]),
  ),
};
// Progress counts the model files (onnx/), which are nearly all of it.
const TOTAL = Object.entries(MODEL_FILES).reduce((sum, [file, size]) => sum + (file.startsWith('onnx/') ? size : 0), 0);

const remoteUrl = (file) => `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${file}`;

// Download progress: listener({ loaded, total }) in bytes, over the model files; files
// already cached count as loaded. Called only while something is downloading.
let listener = null;
export const onDownloadProgress = (fn) => (listener = fn);
const received = new Map(); // file -> bytes downloaded so far in this session
function progress(file, bytes, notify = true) {
  if (!file.startsWith('onnx/')) return;
  received.set(file, bytes);
  if (!notify) return;
  let loaded = 0;
  for (const n of received.values()) loaded += n;
  listener?.({ loaded, total: TOTAL });
}

// Are the files inside the extension? Checked once.
let bundled = null;
const isBundled = () =>
  (bundled ??= fetch(chrome.runtime.getURL('models/supertonic/onnx/tts.json')).then((r) => r.ok, () => false));

async function download(file) {
  const response = await fetch(remoteUrl(file));
  if (!response.ok) throw new Error(`Couldn't download the voice (${file}: HTTP ${response.status})`);
  const chunks = [];
  let bytes = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    bytes += value.length;
    progress(file, bytes);
  }
  const expected = MODEL_FILES[file];
  if (bytes !== expected) throw new Error(`The voice download was incomplete (${file}: ${bytes} of ${expected} bytes)`);
  return new Blob(chunks);
}

// The file's contents as a Response: bundled, cached, or downloaded now (and cached).
const pending = new Map();
export function modelFile(file) {
  if (!(file in MODEL_FILES)) return Promise.reject(new Error(`Unknown model file: ${file}`));
  let promise = pending.get(file);
  if (!promise) {
    promise = (async () => {
      if (await isBundled()) {
        const response = await fetch(chrome.runtime.getURL(`models/supertonic/${file}`));
        if (!response.ok) throw new Error(`Missing model file: ${file}`);
        return response.blob();
      }
      const cache = await caches.open(CACHE);
      const hit = await cache.match(remoteUrl(file));
      if (hit) {
        progress(file, MODEL_FILES[file], false);
        return hit.blob();
      }
      const blob = await download(file);
      await cache.put(remoteUrl(file), new Response(blob));
      return blob;
    })();
    pending.set(file, promise);
    promise.catch(() => pending.delete(file)); // let a later attempt retry
  }
  return promise.then((blob) => new Response(blob));
}

// Old caches from earlier model revisions.
export async function removeOldModels() {
  for (const name of await caches.keys()) {
    if (name.startsWith('supertonic-') && name !== CACHE) await caches.delete(name);
  }
}
