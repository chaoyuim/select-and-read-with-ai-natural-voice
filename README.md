# Selection Reader

A Chrome and Edge extension that reads the text you select aloud, sentence by sentence, with natural-sounding voices, including **Kokoro**, an AI voice model that runs on your own computer.

- Select text and click the floating **▶ Read** button; it turns into a player (pause, speed, stop).
- Each word is highlighted as it's read.
- Voices: Kokoro (local, offline after setup, default **Bella**), Supertonic 3 (local, English for now, faster, with 4, 6 or 8 denoising steps), the system's Premium/Enhanced voices, and Edge's Microsoft Natural voices in Edge.
- Kokoro and Supertonic run on the GPU (WebGPU) or the CPU; the popup's speed test measures both for the selected voice, and Auto then uses whichever was faster.
- Works inside iframes (e.g. e-learning lessons). Shortcuts: Alt+R read, Alt+P pause/resume, Alt+S stop.

## Set up

Needs [Node.js](https://nodejs.org).

```bash
npm install
npm run build
```

`npm run build` bundles the local players into `selection-reader/offscreen.js`, copies the ONNX runtime into `selection-reader/vendor/`, and downloads the Kokoro model and Bella's voice (~330 MB) plus Supertonic 3 and its ten voices (~400 MB) into `selection-reader/models/` so they work offline. These generated files aren't in the repository.

Then load the extension:

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `selection-reader` folder.

After changing files, click the extension's **Reload** button rather than removing and re-adding it: removing deletes its stored data (other Kokoro voices' downloads, settings). Tabs that were already open keep the previous copy of the content script, so refresh them (or press Alt+R once) to pick up the new one.

## Layout

| Path | What it is |
|---|---|
| `selection-reader/manifest.json` | Extension manifest |
| `selection-reader/background.js` | Service worker: reading sessions, system voices (`chrome.tts`), messages |
| `selection-reader/page.js` | Floating Read button and player, word highlighting (runs in every frame) |
| `selection-reader/popup.html`, `popup.js` | Settings: voice, speed, GPU/CPU for the local voices and speed test, Supertonic quality, highlighting |
| `selection-reader/offscreen.html` | Hidden page that runs the local voices and plays their audio |
| `src/offscreen.js` | Source of the local player (built into `selection-reader/offscreen.js`) |
| `src/supertonic.js` | Supertonic 3 engine: four ONNX models, 4/6/8 denoising steps, 44.1 kHz |
| `src/supertonic-helper.js` | Supertonic's browser helper (MIT) |
| `build.mjs` | Build script |

## Third-party software

Kokoro runs through [kokoro-js](https://github.com/hexgrad/kokoro) and [Transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0) on [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (MIT), with the [Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) model (Apache-2.0). Text is turned into pronunciation by [phonemizer](https://github.com/xenova/phonemizer.js), which is built on eSpeak NG (GPL-3.0).

Supertonic 3 uses the [Supertonic](https://github.com/supertone-inc/supertonic) browser example (MIT) and the [Supertonic 3](https://huggingface.co/Supertone/supertonic-3) model weights (OpenRAIL-M). The weights are downloaded by `npm run build` and are not part of the MIT-licensed source.

## License

Copyright (c) 2026 [chaoyuim](https://github.com/chaoyuim). MIT, see [LICENSE](LICENSE): free for anyone to use, change and share.

The MIT licence covers the code in this repository. A built copy of the extension also contains the third-party software above under its own licences; in particular, anyone distributing a built copy has to follow the GPL-3.0 for the eSpeak NG part.
