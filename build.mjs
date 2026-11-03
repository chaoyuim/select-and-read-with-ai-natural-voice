// Builds the local voice for the Selection Reader extension:
//   src/offscreen.js -> selection-reader/offscreen.js (Supertonic player + ONNX runtime bundled)
//   ONNX runtime wasm -> selection-reader/vendor/ort/ (extensions can't load code from a CDN)
//   Supertonic 3 models + voices -> selection-reader/models/supertonic/ (downloaded once,
//     ~400 MB), so the voice works offline and survives removing the extension
//   server.local.json -> selection-reader/server-default.json (the default server's key)
// Run with: npm run build
import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

const entry = process.argv[2] ?? 'src/offscreen.js';
const outfile = process.argv[3] ?? 'selection-reader/offscreen.js';

await esbuild.build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
  minify: true,
  legalComments: 'none',
});

const ortDir = 'selection-reader/vendor/ort';
mkdirSync(ortDir, { recursive: true });
for (const file of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
  cpSync(`node_modules/onnxruntime-web/dist/${file}`, `${ortDir}/${file}`);
}
console.log(`Built ${outfile}`);

// The API key for the default Supertonic server (see background.js), from
// server.local.json ({ "key": "…" }) if it exists. Git ignores both files, so the key
// stays out of the public repository; without it, the key is entered in the popup.
const { key = '' } = existsSync('server.local.json') ? JSON.parse(readFileSync('server.local.json', 'utf8')) : {};
writeFileSync('selection-reader/server-default.json', JSON.stringify({ key }) + '\n');
console.log(key ? 'Default server key: from server.local.json' : 'No default server key (no server.local.json)');

// Downloads a file once; a .part name only becomes the real name when complete.
async function downloadTo(url, dest) {
  if (existsSync(dest) && statSync(dest).size > 0) return; // already downloaded
  mkdirSync(dirname(dest), { recursive: true });
  process.stdout.write(`Downloading ${dest.split('/').at(-1)}… `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${dest}.part`));
  renameSync(`${dest}.part`, dest);
  console.log(`${(statSync(dest).size / 1e6).toFixed(1)} MB`);
}

// Kokoro, the earlier local voice, was dropped for Supertonic; remove its model (~330 MB)
// from builds made before that.
for (const old of ['selection-reader/models/onnx-community', 'selection-reader/models/bundled.json']) {
  if (existsSync(old)) {
    rmSync(old, { recursive: true });
    console.log(`Removed ${old} (Kokoro, no longer used)`);
  }
}

// ── Supertonic 3 ─────────────────────────────────────────
// The local voice: a duration predictor, text encoder, flow-matching vector estimator
// and vocoder, plus one style file per voice. English is used for now.
const SUPERTONIC = 'Supertone/supertonic-3';
const SUPERTONIC_VOICES = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'];
const supertonicFiles = [
  'onnx/duration_predictor.onnx',
  'onnx/text_encoder.onnx',
  'onnx/vector_estimator.onnx',
  'onnx/vocoder.onnx',
  'onnx/tts.json',
  'onnx/unicode_indexer.json',
  ...SUPERTONIC_VOICES.map((v) => `voice_styles/${v}.json`),
];
const supertonicDir = 'selection-reader/models/supertonic';

for (const file of supertonicFiles) {
  await downloadTo(`https://huggingface.co/${SUPERTONIC}/resolve/main/${file}`, `${supertonicDir}/${file}`);
}

writeFileSync(
  `${supertonicDir}/bundled.json`,
  JSON.stringify({ model: SUPERTONIC, voices: SUPERTONIC_VOICES }, null, 2) + '\n',
);
console.log(`Supertonic model and voices (${SUPERTONIC_VOICES.join(', ')}) are in ${supertonicDir}/`);
