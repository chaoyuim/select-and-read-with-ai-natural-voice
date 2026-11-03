// Selection Reader — Supertonic on the user's own server (runs in the extension's
// offscreen document).
//
// An OpenAI-compatible Supertonic server (POST /v1/audio/speech), e.g. on a machine
// with a big GPU. It's the same model with the same voices, so it sounds the same as
// the local engine; it helps most on computers without a fast GPU. The server has to
// allow cross-origin requests (CORS), since the extension calls it from its own origin.

const SAMPLE_RATE = 44100; // Supertonic 3's
const TIMEOUT_MS = 15_000; // then the sentence is made locally instead (see offscreen.js)

// server: { url, key }. Returns { blob, samples, sampleRate }, like speakSupertonic.
export async function speakServer(server, text, voice, steps, speed = 1, signal) {
  const response = await fetch(`${server.url}/v1/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${server.key}`, 'Content-Type': 'application/json' },
    // FLAC: lossless like WAV, at half the size.
    body: JSON.stringify({ input: text, voice, steps, speed, lang: 'en', response_format: 'flac' }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Server: ${await problem(response)}`);
  const blob = await response.blob();
  // Decoded as well, to estimate when each word is spoken.
  const audio = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(await blob.arrayBuffer());
  return { blob, samples: audio.getChannelData(0), sampleRate: audio.sampleRate };
}

// Open the connection ahead of the first sentence (as loading the model does locally).
export function warmServer(server) {
  return fetch(`${server.url}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => {});
}

// The server's reason for an error ({"detail": "Invalid or missing API key"}), or its status.
async function problem(response) {
  const detail = await response.json().then((body) => body?.detail, () => null);
  return typeof detail === 'string' ? detail : `${response.status} ${response.statusText}`.trim();
}
