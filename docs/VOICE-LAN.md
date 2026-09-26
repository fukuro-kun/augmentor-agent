<!-- Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0 -->
# Augmentor Voice (LAN) — dsh-voice-lan

Augmentor-owned speech backend for the native and browser voice surfaces.
It replaces the unavailable private `dsh-resonant-voice` plugin and the
retired local `:8877` speech service. The plugin runs inside the DSH web
server on the existing port — no extra listener or service is introduced.

- Protocol: `augmentor-voice/1` (Augmentor-owned contract; it does **not**
  claim compatibility with the private `resonant-voice/1` wire contract)
- Plugin: `adapters/dsh-voice-lan/` (`index`, `connection`, `inferenz`,
  `wav`, `prose`)
- Speech backends: LAN InferenzQuelle through the existing loopback
  forward (`http://127.0.0.1:8012` → Janus → Acheron). OpenAI-compatible
  `POST /v1/audio/transcriptions` (`file` field, WAV wrapped at 16 kHz)
  and `POST /v1/audio/speech` (`input` field, WAV 24 kHz int16 mono).
- Clients: native `VoiceSession` (apps/native) and the browser voice
  worker (`services/voice/browser-client.py`) share the same engine and
  protocol.

## Setup

`services/dsh/setup.py` registers the plugin as a fourth `insert` entry
in the host-plane `cordis.patch.yml` composition alongside
`augmentor-product`, `augmentor-product-browser` and
`augmentor-product-prompts`. The one-patch-entry replacement is exact
and duplicate-safe; existing user composition is preserved and a
customized owned entry is refused rather than overwritten. After the
patch changes, `dsh-web` must be restarted (`restartRequired`).

The plugin reads the product token from
`<DSH home>/augmentor-product-token` at boot. Optional `config` keys on
the insert entry: `endpoint`, `timeoutMs` (default 115 s), `sttModel`,
`ttsModel`, `voice`, `maxUtteranceSeconds` (600), `maxBufferedBytes`
(20 MiB), `maxSpeechChars` (6000).

## Hands-free endpoint detection

Hands-free mode (`voice_mode`) runs the pinned Silero VAD model locally
on CPU through `onnxruntime`. Install the MIT-licensed model and its
LICENSE beside it:

```sh
mkdir -p ~/.local/share/augmentor/vad
curl -L -o ~/.local/share/augmentor/vad/silero-v6.2.1.onnx \
  https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx
curl -L -o ~/.local/share/augmentor/vad/LICENSE \
  https://github.com/snakers4/silero-vad/raw/master/LICENSE
```

`SileroVad` verifies SHA-256
`1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`
before loading; a missing or changed file raises a German error instead
of silently degrading. A legacy install at
`~/.local/share/resonant-voice/vad/silero-v6.2.1.onnx` is still picked
up as a fallback. `onnxruntime` is a Python dependency (pip or system
package); it is imported lazily so manual push-to-talk mode works
without it.

## Routes

- `GET /api/augmentor-voice` — loopback-only descriptor
  (`{protocol, version, wsPath, leases}`), no token.
- `POST /api/augmentor-voice` — ticket mint. Requires the
  `x-augmentor-product-token` header (timing-safe compare) and JSON
  `{sessionId, surface}`. The session must exist in
  `sessionPersistence` with the `augmentor-linux-product` or
  `augmentor-browser-product` preset and must not be a subagent row.
  Replies `{ok, protocol, url, ticket, sessionId}`; tickets are
  single-use and expire after 60 s.
- `GET /api/augmentor-voice/ws` (upgrade) — loopback-only WebSocket.
  The first message must be `auth {ticket, profile, settings}` within
  15 s of connect; invalid or expired tickets close with a
  non-recoverable German error.

## Session behaviour

- One active voice lease per session; a newer authenticated connection
  takes over and the displaced one is told and closed.
- Client → server: `begin`, `end`, `interrupt`, `settings`,
  `playback-drained` (telemetry). Binary frames carry the utterance as
  16 kHz int16 mono PCM; oversized intake is dropped with a recoverable
  error before any backend call.
- Server → client: `ready`, `listening`, `recording-ended`,
  `transcript` / `empty-transcript`, `timing`, `speaking`,
  `speech-idle`, `turn-complete`, `clear`, `error` (with
  `recoverable`).
  Binary playback frames carry an 8-byte header (generation, frame
  sequence) plus 24 kHz int16 PCM.
- TTS is driven by the DSH `session/event` stream: the final visible
  prose of a `turn/end` with reason `completed` is spoken. `blocked`,
  `max-tokens`, `aborted`, `error` and `interrupted` ends stay silent;
  aborted/interrupted/error ends also stop in-flight playback.
  Reasoning, tool internals and code blocks are stripped by
  `prose.mjs` before synthesis; `maxSpeechChars` bounds the payload.
- `settings {ttsEnabled:false}` drops queued and in-flight playback
  immediately without touching the DSH turn. STT language accepts
  `de`, `en` or `auto` (auto omits the router `language` field).
- Audio exists only in memory. Nothing writes utterance or speech
  content to disk or logs; the router logs byte counts only.

## Verification evidence

Tested ref: `feature/x11-mate-desktop` commits `7c007a2` + `c41e787`
(2026-09-30), Node 22.23.3, DSH 0.1.5-rc.1, live `dsh-web.service` on
127.0.0.1:3080, InferenzQuelle forward on 127.0.0.1:8012.

- `node --test tests/dsh-voice-lan.test.mjs` — 10/10 (boot, routes,
  tickets, auth, fake-backend STT/TTS, ownership, takeover, interrupt,
  errors, oversized utterance without a backend call).
- Live against the running DSH: descriptor 200, ticket mint for a real
  `augmentor-linux-product` session, WS auth → `ready`, real PCM
  utterance → Whisper transcript; TTS WAV via `InferenzVoice.speak`
  (176 kB, ~1.6 s); lease takeover displaces the older connection;
  missing/bad token → 403, foreign/missing session → 400, invalid
  surface → 400.
- Native voice tests: 40/40 under `QT_QPA_PLATFORM=minimal`.
  `QT_QPA_PLATFORM=offscreen` segfaults in Qt 6.10.2/PySide6 layout
  code even on a clean checkout — pre-existing environment issue, use
  `minimal`.
- Setup proof: `DSH_TEST_MODULES=release/dsh/node_modules
  AUGMENTOR_PROOF_QT_PLATFORM=minimal python3 scripts/dsh-setup-proof.py`
  — fresh install, patch preservation, customization refusal,
  reconnect and saved configuration all pass.

## Migration notes

- Preference keys are `voice_enabled`, `voice_mode`, `voice_pause_ms`,
  `voice_tts_enabled`, `voice_stt_language`, `voice_speed`,
  `voice_volume`, `voice_id`, `voice_submit_mode`. A stored legacy
  `resonant_voice` flag is imported once; a former private voice store
  seeds speed/volume/voice when present.
- `voice_submit_mode` (`auto` | `review`, default `auto`) chooses what a
  finished transcript does: `auto` submits it to the session as before;
  `review` parks it in the composer as a draft (native) or sidebar input
  (browser) so dictation errors can be corrected before sending manually.
  The browser lease picks up the mode at `voice/start`; saving voice
  preferences closes an open lease, so the change applies on next open.
  In review mode no `session.prompt` call is made and the server-side
  utterance lifecycle ends with the delivered transcript.
  Review applies only to manual dictation (hold/lock). Hands-free stays a
  conversation mode: the detected pause is the send gesture, so a
  hands-free transcript always submits regardless of `voice_submit_mode`.
- `voice_pause_ms` (hands-free endpointing, default 800) accepts
  400–10000 ms. Longer thresholds suit deliberate dictation: short
  thinking pauses no longer split an utterance into separate turns.
- `dsh-memory` recognises both `resonant-voice:` and `augmentor-voice:`
  request prefixes during the transition; new sessions emit
  `augmentor-voice:`.
- The browser voice lease, submission (`augmentor-voice:` rpcId) and
  settings transport are unchanged in shape; only the ticket route and
  protocol string moved.
- `python3-sounddevice` (+ `libportaudio2` / Fedora `portaudio`) is a
  package dependency of the shared capture/playback engine.

## Remaining work

- Debian package install verified (0.2.12): plugin files shipped under
  `/usr/lib/augmentor/adapters/dsh-voice-lan/`, `GET /api/augmentor-voice`
  live after `dpkg -i` + `dsh-web` restart. The `augmentor-update` staged
  flow is not part of this fork's package install — see the fork note in
  [desktop deployments](DESKTOP-DEPLOYMENTS.md).
- The `ulli_philipp` voice stays the final phase; the plugin accepts a
  configured `voice` name but ships unset (router default).
- Local fallback engine (qualified separately, never auto-enabled).
- Real-microphone user acceptance is not claimed by the synthetic
  evidence above.
