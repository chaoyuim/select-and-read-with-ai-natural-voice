# Selection Reader

A Chrome and Edge extension that reads the text you select aloud, sentence by sentence, with natural-sounding voices, including **Kokoro**, an AI voice model that runs on your own computer.

- Select text and click the floating **▶ Read** button; it turns into a player (pause, speed, stop).
- Each word is highlighted as it's read.
- Voices: Kokoro (local, offline after setup, default **Bella**), the system's Premium/Enhanced voices, and Edge's Microsoft Natural voices in Edge.
- Kokoro runs on the GPU (WebGPU) or the CPU; the popup has a speed test to pick the best one.
- Works inside iframes (e.g. e-learning lessons). Shortcuts: Alt+R read, Alt+P pause/resume, Alt+S stop.

## Set up

Needs [Node.js](https://nodejs.org).

```bash
npm install
npm run build
```

`npm run build` bundles the Kokoro player into `selection-reader/offscreen.js`, copies the ONNX runtime into `selection-reader/vendor/`, and downloads the Kokoro model and Bella's voice (~330 MB) into `selection-reader/models/` so they work offline. These generated files aren't in the repository.

Then load the extension:

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `selection-reader` folder.

After changing files, click the extension's **Reload** button rather than removing and re-adding it: removing deletes its stored data (other Kokoro voices' downloads, settings).

## Layout

| Path | What it is |
|---|---|
| `selection-reader/manifest.json` | Extension manifest |
| `selection-reader/background.js` | Service worker: reading sessions, system voices (`chrome.tts`), messages |
| `selection-reader/page.js` | Floating Read button and player, word highlighting (runs in every frame) |
| `selection-reader/popup.html`, `popup.js` | Settings: voice, speed, Kokoro GPU/CPU and speed test, highlighting |
| `selection-reader/offscreen.html` | Hidden page that runs Kokoro and plays its audio |
| `src/offscreen.js` | Source of the Kokoro player (built into `selection-reader/offscreen.js`) |
| `build.mjs` | Build script |

## Third-party software

Kokoro runs through [kokoro-js](https://github.com/hexgrad/kokoro) and [Transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0) on [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (MIT), with the [Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) model (Apache-2.0). Text is turned into pronunciation by [phonemizer](https://github.com/xenova/phonemizer.js), which is built on eSpeak NG (GPL-3.0).

## License

GPL-3.0-or-later, see [LICENSE](LICENSE). The GPL fits the built extension, which includes eSpeak NG.
