// Builds the Selection Reader extension.
//
// npm run build (personal build, in selection-reader/):
//   src/offscreen.js -> selection-reader/offscreen.js (Supertonic player + ONNX runtime bundled)
//   ONNX runtime wasm -> selection-reader/vendor/ort/ (extensions can't load code from a CDN)
//   Supertonic 3 models + voices -> selection-reader/models/supertonic/ (downloaded once,
//     ~400 MB), so the voice works offline and survives removing the extension
//   server.local.json -> selection-reader/server-default.json (your own server's address,
//     key and server-only voices)
//
// npm run build:store (the Chrome Web Store / Edge Add-ons package):
//   the same, then a copy in dist/selection-reader/ without the models (the extension
//   downloads them on first use, see src/models.js) and without your server, zipped as
//   dist/selection-reader-<version>.zip
import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

const store = process.argv.includes('--store');
const entry = 'src/offscreen.js';
const outfile = 'selection-reader/offscreen.js';

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

// Your own Supertonic server (see background.js), from server.local.json if it exists:
// { "key": "…", "url": "https://…", "voices": ["USER_FEMALE_01", …] }; url and voices
// default to the ones below. Git ignores both files, so the key stays out of the public
// repository; without it, the address and key are entered in the popup.
const PERSONAL_SERVER = {
  url: 'https://supertonic3.chaoyu.nl',
  voices: ['USER_FEMALE_01', 'USER_FEMALE_02', 'USER_FEMALE_03'],
};
const local = existsSync('server.local.json') ? JSON.parse(readFileSync('server.local.json', 'utf8')) : {};
const server = { ...PERSONAL_SERVER, ...local, key: local.key ?? '' };
writeFileSync('selection-reader/server-default.json', JSON.stringify(server) + '\n');
console.log(server.key ? `Default server: ${server.url}, key from server.local.json` : 'No default server key (no server.local.json)');

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
const REVISION = '3cadd1ee6394adea1bd021217a0e650ede09a323'; // keep in step with src/models.js
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

// Files from an earlier revision would be mixed with this one's: start again.
const bundledInfo = `${supertonicDir}/bundled.json`;
if (existsSync(bundledInfo) && JSON.parse(readFileSync(bundledInfo, 'utf8')).revision !== REVISION) {
  const previous = JSON.parse(readFileSync(bundledInfo, 'utf8')).revision;
  if (previous) {
    rmSync(supertonicDir, { recursive: true });
    console.log(`Removed the Supertonic files of revision ${previous.slice(0, 8)}`);
  }
}

for (const file of supertonicFiles) {
  await downloadTo(`https://huggingface.co/${SUPERTONIC}/resolve/${REVISION}/${file}`, `${supertonicDir}/${file}`);
}

writeFileSync(
  `${supertonicDir}/bundled.json`,
  JSON.stringify({ model: SUPERTONIC, revision: REVISION, voices: SUPERTONIC_VOICES }, null, 2) + '\n',
);
console.log(`Supertonic model and voices (${SUPERTONIC_VOICES.join(', ')}) are in ${supertonicDir}/`);

// ── Store package ────────────────────────────────────────
// Everything in selection-reader/ except the models (downloaded on first use) and with
// no server: users who have one enter its address and key in the popup.
if (store) {
  const { version } = JSON.parse(readFileSync('selection-reader/manifest.json', 'utf8'));
  const dir = 'dist/selection-reader';
  const zip = `selection-reader-${version}.zip`;
  rmSync('dist', { recursive: true, force: true });
  cpSync('selection-reader', dir, {
    recursive: true,
    filter: (src) => !/(^|\/)(models|\.DS_Store)$/.test(src),
  });
  writeFileSync(`${dir}/server-default.json`, JSON.stringify({ url: '', key: '', voices: [] }) + '\n');
  execFileSync('zip', ['-qr', `../${zip}`, '.'], { cwd: dir });
  console.log(`Store package: dist/${zip} (${(statSync(`dist/${zip}`).size / 1e6).toFixed(1)} MB), unpacked in ${dir}/`);
}
