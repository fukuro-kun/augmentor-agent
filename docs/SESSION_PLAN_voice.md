<!-- Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0 -->

# SESSION_PLAN_voice — Augmentor Voice über InferenzQuelle

**Session-Ziel:** Eigenes DSH-Host-Plugin `adapters/dsh-voice-lan/` verbindet die
bestehende Voice-Oberfläche (Native + Browser) mit InferenzQuelle über
`127.0.0.1:8012` — batchweises STT (`/v1/audio/transcriptions`) und batchweises
TTS (`/v1/audio/speech`) — unter eigenem Vertrag `augmentor-voice/1`.
Grundlage: Masterplan `/home/fukuro/.devin/plans/plan-d277f30a0a25f159.md`
(freigegeben 2026-09-26 durch Nutzeranweisung „Masterplan durchführen").

## Entscheidungen (Interview-Protokoll)

| Frage | Entscheidung | Begründung |
|---|---|---|
| Backend V1 | InferenzQuelle via Loopback-Forward 8012 | Nutzer-Entscheidung; kein Auto-Fallback |
| Vertrag | `augmentor-voice/1` | `resonant-voice/1`-Artefakt nicht auffindbar (Phase-0-Gate); keine Kompatibilitätsbehauptung |
| Oberflächen | Native + Browser, gemeinsame `VoiceSession` | Bestehende Architektur; Pi ausgenommen |
| STT | Batch nach `end`, `language` de/en/auto | Router ist OpenAI-kompatibel, kein Streaming-STT |
| TTS | Batch, Standard an, eigener Schalter `voice_tts_enabled` | Nutzer-Entscheidung; unabhängig vom Mic-Schalter |
| TTS-Umfang | Alle fertigen sichtbaren Antworten solange Voice-Lease aktiv | inkl. getippter Turns; `turn/end` reason `completed` |
| TTS-Inhalt | Nur `type:'text'`-Blöcke, Code-Fences entfernt | kein Reasoning/Tools/Code, kein Umschreiben |
| TTS aus | Abort laufende HTTP-Arbeit + `clear`-Generation, DSH-Auftrag läuft weiter | Plan-Vorgabe |
| Stimme | Router-Default bzw. Plugin-Config; keine Auswahl in V1 | Uli Philipp = Schlussphase |
| Tempo/Lautstärke | `speed` an Router (API bestätigt), `voice_volume` als lokaler Playback-Gain | Plan 4.4-Bedingungen erfüllt |
| Lokaler Fallback | Nicht in V1, nicht sichtbar | Separate Qualifikation nötig |
| Latenz | Keine SLA; Timeouts begrenzt (STT/TTS ≤ ~115s), saubere Statusübergänge | Nutzer: „dauert so lange wie es dauert", aber kein endlos Hängen |
| Lease-Konflikt | Neue Auth ersetzt alte Verbindung (replace) | Reconnect nach Crash ohne Timeout-Warte; dokumentiert |
| Commits | Zwischencommits erlaubt; Push erst nach Review + separater Freigabe | Nutzer-Korrektur 26.09. |

## Phase-0-Befund (abgeschlossen)

- Kein `dsh-resonant-voice`-Artefakt (Repo, npm, ~/.dsh, /usr/lib) → eigener Vertrag.
- `cordis.patch.yml`: nur 3 Augmentor-Plugins, keine Route-Kollision.
- `registerUpgrade(route)` liefert `(req, socket, head)` → `ws`-Paket (8.21.3, in
  Repo- und `/usr/lib/augmentor/node_modules`) via `wss.handleUpgrade`.
- `session/event` → `(session, event)`; `session.snapshotEvents(cursor)`;
  `assistant/message` `data.message.content` Blöcke (`type:'text'` = sichtbar).
- `turn/end` `reason.kind`: completed|blocked|max-tokens|aborted|error|interrupted.
- InferenzQuelle: STT Pflicht nur `file`; TTS Pflicht nur `input`; Ausgabe WAV
  24 kHz int16 mono; Router loggt nur Pfad+Bytezahl (keine Inhalte, keine
  Dateiablage); `TTS_TIMEOUT` 120 s; Backend `styx:8082`, `vram_active` derzeit
  warm. `model`/`voice`/`speed`/`language`/`response_format` optional.
- Client-Vertrag aus `voice.py` rekonstruiert (auth/begin/end/interrupt/
  playback-drained; Events ready/listening/transcript/speaking/speech-idle/
  clear/turn-complete/empty-transcript/error/timing; Binärframes
  `[u32 generation][u32 seq][pcm24k]`).
- `python3-sounddevice` fehlt auf Hydra → apt-Paket + deb-Depends.

## Schritte

| # | Schritt | Status |
|---|---|---|
| 1 | `adapters/dsh-voice-lan/` (index/connection/inferenz/wav/prose) | ☐ |
| 2 | `services/dsh/setup.py`: 4. Patch-Eintrag + Proof-Update | ☐ |
| 3 | Native: dsh.py Ticket, voice.py Präfix/Settings/Gain, window.py | ☐ |
| 4 | Preferences: `voice_tts_enabled`, `voice_stt_language`, `voice_speed`, `voice_volume` | ☐ |
| 5 | VoiceSettings-Dialog: TTS-/Sprach-Controls, lokale Dienst-Abhängigkeit trennen | ☐ |
| 6 | Browser: pipe.mjs, voice-client.mjs, services/voice/preferences.py | ☐ |
| 7 | dsh-memory rpcId-Präfix (alt+neu) | ☐ |
| 8 | Tests: Plugin-Contract-Tests neu; Bestehende an neuen Vertrag anpassen | ☐ |
| 9 | `python3-sounddevice` install + deb-Depends | ☐ |
| 10 | Setup-Run → DSH-Restart → Plugin-Proof live | ☐ |
| 11 | Live-Verifikation (synthetisch STT+TTS, Lease, Interrupt) | ☐ |
| 12 | Doku (SOURCES/ARCHITECTURE/DSH-SETUP/DATA-AND-SUPPORT/VOICE-*/AGENTS.md) + Trilium | ☐ |
| 13 | Review-Subagent → Fixes → Commit | ☐ |

## Verifikations-Strategie

- Plugin-Unit-/Contracttests mit Fake-STT/TTS-HTTP-Server (node:test): Multipart-
  Korrektheit, WAV-Validierung, Ticket einmalig+expiry, Preset-Allowlist, Lease-
  Ownership, Puffergrenze, Fehlerübersetzung, Abort/Generation, kein Audio-Logging.
- `scripts/dsh-setup-proof.py` unverändert grün + Patch-Idempotenz.
- Bestehend: `npm run check`, `npm run build`, `npm test`,
  `npm run test:native`, `node --test apps/browser/test/*.test.mjs`.
- Live: synthetische WAV → STT über Plugin; Antwort-Turn → TTS → PCM-Frames;
  Metrik Vorher/Nachher: Voice funktionierte vorher nicht (Plugin fehlte) —
  Nachher: Ticket+WS+Transkript+Playback-Ende-zu-Ende.

## Live-Verifikations-Szenario (PFLICHT)

**Szenario:** DSH läuft mit `augmentor-voice-lan`-Plugin; ein Script-Client
spricht `augmentor-voice/1`.
**Akzeptanzkriterien:**
- [ ] `POST /api/augmentor-voice` mit Produkt-Token liefert Ticket (protocol,
      ws-URL, sessionId) für `augmentor-linux-product`-Session
- [ ] WS-Auth → `ready`; `begin` → `listening` mit requestId
- [ ] 1.5 s synthetische Sprach-WAV (TTS-generiert) als PCM-Frames → `end` →
      `transcript`-Event mit nicht-leerem deutschem Text, gleiche requestId
- [ ] Antwort-Turn (simulierter `session/event`-Pfad oder echter Prompt) →
      `speaking` + PCM-Frames + `speech-idle` + `turn-complete`
- [ ] `interrupt` → `clear`, keine späten Frames
- [ ] Fehlerfälle: falsches Ticket → WS-Close; Fremdpreset → 403
- [ ] DSH-Log enthält keine Audiodaten/Transkripte

## Defaults bei Unklarheit

- Stimmenauswahl: Plugin-Config `voice` (Default: Router-Standard →
  `input`-only Request), kein UI.
- `maxUtteranceSeconds`: 600 (Client-Cap), Server-Puffer 20 MiB → Überschreitung
  = `recording-ended` + sichtbarer Fehler.
- Prosa-Extraktion: letzte `assistant/message` des Turns, `type:'text'`,
  ```-Fences + Inline-Code-Zeilen entfernt, min. 1 Zeichen sonst kein TTS.

## Recherche-Fallbacks

| Block | Problem | Reaktion |
|---|---|---|
| Plugin-Load | ctx-API anders als erwartet | dsh-product/dsh-memory als Referenz; DSH-Log lesen |
| WS-Upgrade | Handler-Signatur | `handleUpgrade` von ws verwendet, sonst manueller Handshake |
| session/event | Form abweichend | `snapshotEvents` lesen wie dsh-memory |
| STT-Fehler | Router 5xx/Timeout | Fehlerklasse mappen (502/503/504→deutsche Meldung) |
| apt-Paket | `python3-sounddevice` alt | Version prüfen; Fallback pip-User-Install dokumentieren |

## Offene Fragen

- Exakte Router-Uploadgrenze unbekannt → Server-Puffer 20 MiB als harte Grenze,
  darüber sichtbare Ablehnung (Plan-Vorgabe).
- Ob `assistant/message` Reasoning als separaten Blocktyp trägt → Filter
  whitelistet nur `text`; Rest bleibt stumm (sicher).

## Folge-Plan

- `SESSION_PLAN_voice_fallback.md` (Phase 5 Masterplan: lokaler Fallback, nur
  nach separater Qualifikation + Freigabe)
- `SESSION_PLAN_voice_stimme.md` (Phase 6: Uli-Philipp-Stimme, Schlussphase)
