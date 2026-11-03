// Builds the Kokoro bundle for the Selection Reader extension:
//   src/offscreen.js -> selection-reader/offscreen.js (kokoro-js + transformers.js bundled)
//   ONNX runtime wasm -> selection-reader/vendor/ort/ (extensions can't load code from a CDN)
//   Kokoro model + voices -> selection-reader/models/ (downloaded once, ~330 MB), so the
//     voice works without downloading anything and survives removing the extension
// Run with: npm run build
import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
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
  plugins: [
    {
      // kokoro-js reads voice files from disk when running under Node; in the
      // browser it downloads them instead, so these Node modules can be empty.
      name: 'node-stubs',
      setup(build) {
        build.onResolve({ filter: /^(path|fs\/promises)$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default {};' }));
      },
    },
  ],
});

const ortDir = 'selection-reader/vendor/ort';
mkdirSync(ortDir, { recursive: true });
for (const file of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
  cpSync(`node_modules/@huggingface/transformers/dist/${file}`, `${ortDir}/${file}`);
}
console.log(`Built ${outfile}`);

// ── Kokoro model ─────────────────────────────────────────
// Laid out the way transformers.js looks for local models (<localModelPath>/<repo>/<file>).
// The model (fp32, used on the GPU) is shared by all voices; other voices download
// their small file (<1 MB) the first time they're used.
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const BUNDLED_VOICES = ['af_bella'];
const files = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model.onnx',
  ...BUNDLED_VOICES.map((v) => `voices/${v}.bin`),
];
const modelDir = `selection-reader/models/${MODEL}`;

for (const file of files) {
  const dest = `${modelDir}/${file}`;
  if (existsSync(dest) && statSync(dest).size > 0) continue; // already downloaded
  mkdirSync(dirname(dest), { recursive: true });
  const url = `https://huggingface.co/${MODEL}/resolve/main/${file}`;
  process.stdout.write(`Downloading ${file}… `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${dest}.part`));
  renameSync(`${dest}.part`, dest); // only complete files get the real name
  console.log(`${(statSync(dest).size / 1e6).toFixed(1)} MB`);
}

// Tells the extension what's bundled (read by offscreen.js and popup.js).
writeFileSync(
  'selection-reader/models/bundled.json',
  JSON.stringify({ model: MODEL, voices: BUNDLED_VOICES }, null, 2) + '\n',
);
console.log(`Kokoro model and voices (${BUNDLED_VOICES.join(', ')}) are in selection-reader/models/`);
