# Selection Reader

A Chrome and Edge extension that reads the text you select aloud, sentence by sentence, with natural-sounding voices, including **Supertonic 3**, an AI voice model that runs on your own computer.

- Select text and click the floating **▶ Read** button; it turns into a player (pause, speed, stop). Supertonic speaks Slow and Fast at that pace itself rather than stretching the audio.
- Each word is highlighted as it's read.
- Voices: Supertonic 3 (local and offline, ten voices, default **F1**, quality 8 to 32 denoising steps), plus any voices only your own Supertonic server has (see [below](#your-own-supertonic-server)), the system's Premium/Enhanced voices, and Edge's Microsoft Natural voices in Edge.
- Supertonic reads in the language picked in the popup: English (the default) or any of its 30 other languages, such as Japanese or Dutch, or "Other or mixed" for text in other or several languages.
- Supertonic runs on the GPU (WebGPU) or the CPU, or on [your own Supertonic server](#your-own-supertonic-server); the popup's speed test measures each, and Auto then uses whichever was clearly fastest.
- Works inside iframes (e.g. e-learning lessons). Shortcuts: Alt+R read, Alt+P pause/resume, Alt+S stop.
- The Read button can show on every site (the default) or only on sites you list in the popup, including their subdomains. A site is the one in the address bar, also for text in an iframe. Alt+R and the right-click menu read on every site.

## Set up

Needs [Node.js](https://nodejs.org).

```bash
npm install
npm run build
```

`npm run build` bundles the Supertonic player into `selection-reader/offscreen.js`, copies the ONNX runtime into `selection-reader/vendor/`, and downloads Supertonic 3 and its ten voices (~400 MB) into `selection-reader/models/` so they work offline. These generated files aren't in the repository.

Optionally, to have [your own server](#your-own-supertonic-server) filled in, put it in `server.local.json` next to `build.mjs` before building: `{ "key": "…", "url": "https://…", "voices": ["USER_FEMALE_01"] }` (`url` and `voices` default to the ones in `build.mjs`). Git ignores that file and the copy the build makes (`selection-reader/server-default.json`), so the key isn't published.

Then load the extension:

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `selection-reader` folder.

After changing files, click the extension's **Reload** button rather than removing and re-adding it: removing deletes its stored data (settings, speed test). Tabs that were already open keep the previous copy of the content script, so refresh them (or press Alt+R once) to pick up the new one.

## Store package

```bash
npm run build:store
```

makes `dist/selection-reader-<version>.zip` (about 5 MB) for the Chrome Web Store and Microsoft Edge Add-ons. It's the same extension without the voice models and without your server:

- The Supertonic 3 model is downloaded once from Hugging Face, at a fixed revision (`src/models.js`), the first time the voice runs; the player shows "Downloading voice N%". It's kept in the extension's Cache Storage (`unlimitedStorage`), so it works offline afterwards and goes away with the extension.
- The server's address, key and server-only voices are empty: users with a server enter its address and key in the popup.

The listing text, permission justifications and reviewer notes are in [store/listing.md](store/listing.md), the screenshots and promo tile in `store/`, and the privacy policy in [PRIVACY.md](PRIVACY.md).

## Your own Supertonic server

Under **Supertonic runs on**, **Server** sends the text to a Supertonic server of your own (for example on a machine with a big GPU) and plays the speech it returns. It's the same model and voices, so it sounds the same. It helps most on computers without a fast graphics card, where 16 or more steps can't keep up locally. Enter its address and API key in the popup, or build them in with `server.local.json` (see [Set up](#set-up)); a personal build defaults to `https://supertonic3.chaoyu.nl`, the store package to none. Voices listed under `voices` there, which only the server has, always read through it. The key is kept in that browser only (`chrome.storage.local`), and the text you read is sent to the server. The speech it returns (FLAC) is only held in memory while it plays; nothing is saved.

The server needs an OpenAI-compatible `POST /v1/audio/speech` that takes a bearer key and Supertonic's options (`voice` F1–M5, `steps`, `speed`, `lang`, `response_format: "flac"`), and it must allow cross-origin requests (CORS). If it can't be reached or rejects the key, the rest of that reading is made on your computer instead.

## Layout

| Path | What it is |
|---|---|
| `selection-reader/manifest.json` | Extension manifest |
| `selection-reader/background.js` | Service worker: reading sessions, system voices (`chrome.tts`), messages |
| `selection-reader/page.js` | Floating Read button and player, word highlighting (runs in every frame) |
| `selection-reader/popup.html`, `popup.js` | Settings: voice, language, speed, Supertonic quality, GPU/CPU/server and speed test, highlighting, Read button sites |
| `selection-reader/offscreen.html` | Hidden page that runs Supertonic and plays its audio |
| `src/offscreen.js` | Source of the Supertonic player (built into `selection-reader/offscreen.js`) |
| `src/supertonic.js` | Supertonic 3 engine: four ONNX models, 8/16/24/32 denoising steps, 44.1 kHz |
| `src/supertonic-helper.js` | Supertonic's browser helper (MIT) |
| `src/models.js` | Where the Supertonic files come from: bundled, or downloaded once and cached (store package) |
| `src/server.js` | Supertonic on your own server (OpenAI-compatible API) |
| `build.mjs` | Build script (`npm run build`, `npm run build:store`) |
| `selection-reader/THIRD_PARTY_NOTICES.txt` | Licences of the bundled third-party software |
| `PRIVACY.md`, `store/` | Privacy policy, store listing and images |

## Third-party software

Supertonic 3 runs on [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (MIT) through the [Supertonic](https://github.com/supertone-inc/supertonic) browser example (MIT), with the [Supertonic 3](https://huggingface.co/Supertone/supertonic-3) model weights (OpenRAIL-M). The weights are downloaded by `npm run build` (or by the store package on first use) and are not part of the MIT-licensed source. See `selection-reader/THIRD_PARTY_NOTICES.txt`.

## License

Copyright (c) 2026 [chaoyuim](https://github.com/chaoyuim). MIT, see [LICENSE](LICENSE): free for anyone to use, change and share.

The MIT licence covers the code in this repository. A built copy of the extension also contains the third-party software above under its own licences; in particular, the Supertonic 3 weights come with OpenRAIL-M's use restrictions.
