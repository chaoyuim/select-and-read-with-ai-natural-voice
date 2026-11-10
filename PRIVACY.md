# Selection Reader privacy policy

_Last updated: 10 November 2026_

Selection Reader is a browser extension that reads the text you select aloud. It is made by an individual developer ([chaoyuim](https://github.com/chaoyuim)) and has no servers, accounts, analytics or advertising of its own.

## What it reads, and where that text goes

The extension only reads text you select and ask it to read (with the Read button, Alt+R or the right-click menu). Where that text goes depends on the voice and device you pick in the extension's settings:

- **Supertonic voices on this computer (the default, "GPU", "CPU" or "Auto"):** the text is turned into speech inside your browser. It never leaves your computer.
- **System voices:** the text is passed to your browser's text-to-speech service (`chrome.tts`). Voices your operating system has installed speak it on your computer. Voices marked "Online", such as Microsoft Edge's Natural voices, are provided by your browser's maker, which receives the text under its own privacy policy.
- **Your own Supertonic server ("Server"):** only if you enter the address and API key of a server you choose, the text is sent to that server, which returns the speech. That server's owner (normally you) decides what happens to it.

The speech is held in memory only while it plays. Nothing you read is stored, logged or sent anywhere else by the extension.

## What it downloads

The first time a Supertonic voice runs on your computer, the extension downloads the Supertonic 3 voice model (about 400 MB) once from Hugging Face (`huggingface.co`) and keeps it in the extension's own storage on your computer. Like any download, Hugging Face sees your IP address; no text or personal information is sent with it. Removing the extension removes the model.

## What it stores

- **Settings** (voice, speed, language, quality, device, word highlighting, and the list of sites that show the Read button) are kept in your browser's extension storage. If you use browser sync, your browser syncs them to your other devices.
- **Your server's address and API key**, if you enter them, and the result of the speed test are kept on this computer only.
- **The voice model**, see above.

The extension does not collect, sell or share personal information, browsing history or the content of the pages you visit. The Read button runs on web pages so it can appear when you select text; it doesn't read or send anything until you ask it to read.

## Permissions

- **Access to the sites you visit** (content script on all sites): to show the Read button and highlight words where you select text.
- **activeTab, scripting:** to read the selection in the current tab when you press Alt+R or use the right-click menu.
- **contextMenus:** the "Read selection aloud" menu item.
- **tts:** the system voices.
- **storage, unlimitedStorage:** your settings, and the voice model on your computer.
- **offscreen:** a hidden extension page that runs the voice model and plays its audio.

## Changes and contact

Changes to this policy are published in this file, with its history on [GitHub](https://github.com/chaoyuim/select-and-read-with-ai-natural-voice/commits/main/PRIVACY.md). Questions: open an issue at <https://github.com/chaoyuim/select-and-read-with-ai-natural-voice/issues>.
