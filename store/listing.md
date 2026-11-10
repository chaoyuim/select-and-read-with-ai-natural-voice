# Store listing: Selection Reader

Text and answers for the Chrome Web Store and Microsoft Edge Add-ons forms. Upload `dist/selection-reader-<version>.zip` from `npm run build:store` (no voice models, no server key).

## Basics

- **Name:** Selection Reader
- **Short description / summary** (from the manifest, 132 characters max): Reads the text you select aloud with natural AI voices that run on your own computer, highlighting each word.
- **Category:** Chrome: Accessibility (or Productivity → Education as a second choice). Edge: Accessibility.
- **Language:** English
- **Visibility:** Public
- **Price:** Free
- **Homepage / support URL:** https://github.com/chaoyuim/select-and-read-with-ai-natural-voice
- **Privacy policy URL:** https://github.com/chaoyuim/select-and-read-with-ai-natural-voice/blob/main/PRIVACY.md
- **Images:** `store/screenshot-1-read-button.png`, `store/screenshot-2-player.png`, `store/screenshot-3-settings.png` (1280×800), `store/promo-small-440x280.png` (small promo tile), icon `selection-reader/icons/icon-128.png`.

## Detailed description

Select text, click Read, and listen. Selection Reader reads exactly the text you select, sentence by sentence, in a natural-sounding AI voice, and highlights each word as it's spoken.

Natural voices that run on your computer
• Supertonic 3, a modern AI voice model, runs inside your browser on your graphics card (WebGPU) or processor. The text you read never leaves your computer.
• Ten voices (five female, five male), 31 languages including English, Dutch, German, French, Spanish, Japanese and Korean, and four quality levels.
• The voice is downloaded once (about 400 MB) the first time you use it, then works offline.
• Prefer your system's voices? The Premium and Enhanced voices on macOS and Microsoft Edge's Natural voices are there too.

Made for reading, not fiddling
• A small Read button appears next to your selection and turns into a player: pause, Slow / Normal / Fast, stop.
• Slow and Fast are spoken at that pace by the voice itself, not stretched audio.
• Works inside iframes, such as e-learning lessons and course players.
• Keyboard shortcuts: Alt+R read, Alt+P pause or resume, Alt+S stop. Or right-click → Read selection aloud.
• Show the Read button on every site, or only on the sites you choose.

Private by design
• No account, no tracking, no ads.
• Nothing is read until you ask, and nothing you read is stored.
• Have your own Supertonic server? Point the extension at it to read on a bigger GPU.

Open source (MIT): https://github.com/chaoyuim/select-and-read-with-ai-natural-voice

## Single purpose (Chrome "Privacy practices" tab)

Reads text the user selects on a web page aloud with text-to-speech, and highlights each word as it is read.

## Permission justifications

- **activeTab:** When the user presses the Alt+R shortcut or chooses "Read selection aloud" from the right-click menu, the extension reads the selected text in the current tab, including in frames.
- **scripting:** Used with activeTab to get the selected text, and to add the reading player and word highlighting to tabs that were open before the extension was installed or updated, when the user asks to read.
- **contextMenus:** Adds "Read selection aloud" and "Stop reading" to the right-click menu.
- **tts:** Lets the user pick one of the system's text-to-speech voices instead of the built-in AI voice.
- **storage:** Saves the user's settings (voice, speed, language, quality, highlighting, sites that show the Read button) and, on this computer only, the address and key of the user's own speech server if they enter one.
- **unlimitedStorage:** The built-in AI voice model (about 400 MB) is downloaded once and kept in the extension's Cache Storage so it works offline and isn't downloaded again; without this, the browser could evict it.
- **offscreen:** The AI voice model runs, and its audio plays, in an offscreen document (a service worker can't play audio or run WebGPU/WebAssembly models of this size).
- **Host permissions / content script on all URLs:** The Read button and word highlighting must appear on whatever page the user selects text on, including inside iframes such as e-learning players. The content script does nothing until the user selects text, sends nothing until the user asks to read, and the user can limit the Read button to chosen sites.
- **Remote code:** No. All code is in the package. The extension downloads the Supertonic 3 model weights (data, not code) from huggingface.co at a fixed revision; the ONNX Runtime WebAssembly that runs them is in the package.

## Data usage (Chrome "Privacy practices" checkboxes)

- **Website content:** Yes. Text the user selects is processed to read it aloud. With the default voice this happens on the user's computer; it is sent elsewhere only to the user's chosen system voice provider or the user's own server. It is not collected by the developer.
- All other categories (personally identifiable information, health, financial, authentication, personal communications, location, web history, user activity): No.
- Certify: not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used to determine creditworthiness or for lending.

## Notes for the reviewer (Chrome "Test instructions", Edge "Notes for certification")

No account or login is needed. To test: open any article, select a paragraph, and click the ▶ Read button that appears below it (or press Alt+R). The first reading downloads the voice model (about 400 MB, progress shows in the player as "Downloading voice N%"); later readings start at once. The toolbar popup has the settings, including "Play sample". The "Server" option needs a user's own server and is optional.
