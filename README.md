# Selection Reader

A Chrome and Edge extension that reads the text you select aloud, sentence by sentence, with natural-sounding voices, including **Supertonic 3**, an AI voice model that runs on your own computer.

- Select text and click the floating **▶ Read** button; it turns into a player (pause, speed, stop). Supertonic speaks Slow and Fast at that pace itself rather than stretching the audio.
- Each word is highlighted as it's read.
- Voices: Supertonic 3 (local and offline, English for now, ten voices, default **F1**, quality from 4 to 16 denoising steps), the system's Premium/Enhanced voices, and Edge's Microsoft Natural voices in Edge.
- Supertonic runs on the GPU (WebGPU) or the CPU; the popup's speed test measures both, and Auto then uses whichever was faster.
- Works inside iframes (e.g. e-learning lessons). Shortcuts: Alt+R read, Alt+P pause/resume, Alt+S stop.

## Set up

Needs [Node.js](https://nodejs.org).

```bash
npm install
npm run build
```

`npm run build` bundles the Supertonic player into `selection-reader/offscreen.js`, copies the ONNX runtime into `selection-reader/vendor/`, and downloads Supertonic 3 and its ten voices (~400 MB) into `selection-reader/models/` so they work offline. These generated files aren't in the repository.

Then load the extension:

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `selection-reader` folder.

After changing files, click the extension's **Reload** button rather than removing and re-adding it: removing deletes its stored data (settings, speed test). Tabs that were already open keep the previous copy of the content script, so refresh them (or press Alt+R once) to pick up the new one.

## Layout

| Path | What it is |
|---|---|
| `selection-reader/manifest.json` | Extension manifest |
| `selection-reader/background.js` | Service worker: reading sessions, system voices (`chrome.tts`), messages |
| `selection-reader/page.js` | Floating Read button and player, word highlighting (runs in every frame) |
| `selection-reader/popup.html`, `popup.js` | Settings: voice, speed, Supertonic quality, GPU/CPU and speed test, highlighting |
| `selection-reader/offscreen.html` | Hidden page that runs Supertonic and plays its audio |
| `src/offscreen.js` | Source of the Supertonic player (built into `selection-reader/offscreen.js`) |
| `src/supertonic.js` | Supertonic 3 engine: four ONNX models, 4/6/8/16 denoising steps, 44.1 kHz |
| `src/supertonic-helper.js` | Supertonic's browser helper (MIT) |
| `build.mjs` | Build script |

## Third-party software

Supertonic 3 runs on [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (MIT) through the [Supertonic](https://github.com/supertone-inc/supertonic) browser example (MIT), with the [Supertonic 3](https://huggingface.co/Supertone/supertonic-3) model weights (OpenRAIL-M). The weights are downloaded by `npm run build` and are not part of the MIT-licensed source.

## License

Copyright (c) 2026 [chaoyuim](https://github.com/chaoyuim). MIT, see [LICENSE](LICENSE): free for anyone to use, change and share.

The MIT licence covers the code in this repository. A built copy of the extension also contains the third-party software above under its own licences; in particular, the Supertonic 3 weights come with OpenRAIL-M's use restrictions.
