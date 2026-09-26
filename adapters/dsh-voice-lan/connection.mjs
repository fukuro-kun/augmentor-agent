// Augmentor — DSH voice plugin over LAN InferenzQuelle
// Copyright © 2026 Manolo Remiddi
// SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
// License: MIT with Augmentor Resale Restriction — see LICENSE at the repository root.

// One augmentor-voice/1 WebSocket connection: authenticated utterance intake,
// batch transcription, and paced PCM playback. Audio exists only in memory.
import { randomUUID } from 'node:crypto'
import { wavToPcm } from './wav.mjs'
import { stripForSpeech } from './prose.mjs'
import { REQUEST_PREFIX } from './index.mjs'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const CHUNK_BYTES = 960 // 20 ms of 24 kHz mono int16
const PRIME_CHUNKS = 10 // ~200 ms initial jitter reserve, then realtime pacing

function backendMessage(error, scope) {
  const status = error?.status ?? 0
  const prefix = scope === 'tts' ? 'Sprachausgabe' : 'Spracherkennung'
  if (status === 504) return `${prefix}: Der Sprachdienst hat nicht rechtzeitig geantwortet.`
  if (status === 502 || status === 503) return `${prefix}: Der Sprachdienst ist nicht erreichbar. Schriftliche Antworten bleiben möglich.`
  if (status === 413) return `${prefix}: Die Anfrage ist zu groß für den Sprachdienst.`
  return `${prefix} ist fehlgeschlagen${status ? ` (${status})` : ''}.`
}

export class VoiceConnection {
  constructor(ws, plugin) {
    this.ws = ws
    this.plugin = plugin
    this.authed = false
    this.closed = false
    this.sessionId = null
    this.profile = ''
    this.settings = { ttsEnabled: true, sttLanguage: 'de', speechSpeed: 1 }
    this.utterance = null // {requestId, chunks, bytes}
    this.generation = 0
    this.frameSeq = 0
    this.requestEpoch = 0
    this.sttWork = null
    this.ttsWork = null
    this.pendingAnswer = null // {text, rpcId, turn} from the session watcher
    this.pendingRpc = null
    this.authTimer = setTimeout(() => {
      if (!this.authed) this.fail('Sprachanmeldung fehlgeschlagen.', false)
    }, 15000)
    this.authTimer.unref?.()
    ws.on('message', (data, isBinary) => this.onMessage(data, isBinary))
    ws.on('close', () => this.dispose())
    ws.on('error', () => this.dispose())
  }

  send(value) {
    if (!this.closed && this.ws.readyState === 1) this.ws.send(JSON.stringify(value))
  }

  sendFrame(generation, pcm) {
    if (this.closed || this.ws.readyState !== 1) return
    const header = Buffer.alloc(8)
    header.writeUInt32LE(generation >>> 0, 0)
    header.writeUInt32LE((this.frameSeq++) >>> 0, 4)
    this.ws.send(Buffer.concat([header, pcm]))
  }

  fail(message, recoverable) {
    this.send({ type: 'error', message, recoverable })
    this.close()
  }

  // A newer connection claimed this session's voice lease.
  takeover() {
    this.send({ type: 'error', message: 'Diese Unterhaltung wurde in einer anderen Sprachverbindung geöffnet.', recoverable: false })
    this.dispose()
  }

  applySettings(value) {
    if (!value || typeof value !== 'object') return
    if (typeof value.ttsEnabled === 'boolean') {
      const was = this.settings.ttsEnabled
      this.settings.ttsEnabled = value.ttsEnabled
      if (was && !value.ttsEnabled) this.silence()
    }
    if (['de', 'en', 'auto'].includes(value.sttLanguage)) this.settings.sttLanguage = value.sttLanguage
    if (typeof value.speechSpeed === 'number' && Number.isFinite(value.speechSpeed))
      this.settings.speechSpeed = Math.max(0.5, Math.min(2, value.speechSpeed))
  }

  // Discard queued/in-flight speech without touching the DSH task.
  silence() {
    if (this.ttsWork) this.ttsWork.abort()
    this.pendingAnswer = null
    this.generation++
    this.send({ type: 'clear', generation: this.generation })
  }

  interruptPlayback() {
    this.silence()
  }

  onMessage(data, isBinary) {
    if (this.closed) return
    if (isBinary) {
      const utterance = this.utterance
      if (!utterance) return
      utterance.bytes += data.length
      if (utterance.bytes > this.plugin.config.maxBufferedBytes) {
        this.utterance = null
        this.send({ type: 'recording-ended' })
        this.send({ type: 'error', message: 'Die Aufnahme ist zu lang für den Sprachdienst.', recoverable: true })
        return
      }
      utterance.chunks.push(data)
      return
    }
    let value
    try { value = JSON.parse(data.toString('utf8')) } catch { return this.fail('Ungültige Sprachnachricht.', false) }
    if (typeof value?.type !== 'string') return
    if (!this.authed) {
      if (value.type === 'auth') this.authenticate(value)
      else this.fail('Sprachanmeldung erforderlich.', false)
      return
    }
    switch (value.type) {
      case 'begin': this.begin(); break
      case 'end': this.end(); break
      case 'interrupt': this.interrupt(); break
      case 'settings': this.applySettings(value); break
      case 'playback-drained': break // client pacing telemetry; nothing to do
      default: break
    }
  }

  authenticate(value) {
    clearTimeout(this.authTimer)
    const ticket = typeof value.ticket === 'string' ? value.ticket : ''
    const entry = this.plugin.tickets.get(ticket)
    if (!entry || entry.expires < Date.now()) {
      this.plugin.tickets.delete(ticket)
      return this.fail('Sprachticket ist ungültig oder abgelaufen.', false)
    }
    this.plugin.tickets.delete(ticket) // one-time use
    this.sessionId = entry.sessionId
    this.profile = typeof value.profile === 'string' ? value.profile.slice(0, 64) : ''
    const prior = this.plugin.leases.get(entry.sessionId)
    if (prior && prior !== this) prior.takeover()
    this.plugin.leases.set(entry.sessionId, this)
    this.authed = true
    this.applySettings(value.settings)
    this.send({
      type: 'ready',
      protocol: 'augmentor-voice/1',
      sessionId: this.sessionId,
      maxUtteranceSeconds: this.plugin.config.maxUtteranceSeconds,
    })
  }

  begin() {
    if (this.utterance || this.sttWork) return
    this.utterance = { requestId: randomUUID(), chunks: [], bytes: 0 }
    this.send({ type: 'listening', requestId: this.utterance.requestId, sessionId: this.sessionId })
  }

  end() {
    const utterance = this.utterance
    this.utterance = null
    if (!utterance) return
    void this.transcribe(utterance, ++this.requestEpoch)
  }

  interrupt() {
    this.utterance = null
    this.requestEpoch++
    if (this.sttWork) this.sttWork.abort()
    this.silence()
  }

  async transcribe(utterance, epoch) {
    const control = new AbortController()
    this.sttWork = control
    const started = performance.now()
    try {
      const language = this.settings.sttLanguage === 'auto' ? null : this.settings.sttLanguage
      const text = await this.plugin.inferenz.transcribe(
        Buffer.concat(utterance.chunks), { language, signal: control.signal })
      if (this.closed || this.requestEpoch !== epoch) return
      this.send({ type: 'timing', stage: 'asr-final', elapsedMs: Math.round(performance.now() - started) })
      if (text) {
        this.send({ type: 'transcript', requestId: utterance.requestId, sessionId: this.sessionId, text })
      } else {
        this.send({ type: 'empty-transcript', requestId: utterance.requestId, sessionId: this.sessionId })
      }
    } catch (error) {
      if (this.closed || this.requestEpoch !== epoch || control.signal.aborted) return
      this.send({ type: 'error', message: backendMessage(error, 'stt'), recoverable: true })
    } finally {
      if (this.sttWork === control) this.sttWork = null
    }
  }

  // Called by the plugin's session/event watcher with the final visible prose
  // of a completed turn. Newest answer wins; stale playback is invalidated.
  async speakAnswer(text, meta = {}) {
    if (this.closed || !this.settings.ttsEnabled) return
    const spoken = stripForSpeech(text, { maxChars: this.plugin.config.maxSpeechChars })
    if (!spoken) return
    if (this.ttsWork) this.ttsWork.abort()
    const control = new AbortController()
    this.ttsWork = control
    const generation = ++this.generation
    this.send({ type: 'clear', generation })
    try {
      const wav = await this.plugin.inferenz.speak(spoken, { speed: this.settings.speechSpeed, signal: control.signal })
      const { pcm } = wavToPcm(wav, { rate: 24000 })
      if (this.closed || control.signal.aborted) return
      this.send({ type: 'speaking', generation })
      let offset = 0
      for (let burst = 0; burst < PRIME_CHUNKS && offset < pcm.length; burst++) {
        this.sendFrame(generation, pcm.subarray(offset, offset + CHUNK_BYTES))
        offset += CHUNK_BYTES
      }
      while (offset < pcm.length) {
        await sleep(20)
        if (this.closed || control.signal.aborted) return
        this.sendFrame(generation, pcm.subarray(offset, offset + CHUNK_BYTES))
        offset += CHUNK_BYTES
      }
      this.send({ type: 'speech-idle', generation })
      const requestId = typeof meta.rpcId === 'string' && meta.rpcId.startsWith(REQUEST_PREFIX)
        ? meta.rpcId : undefined
      this.send({ type: 'turn-complete', generation, ...(requestId ? { requestId } : {}) })
    } catch (error) {
      if (this.closed || control.signal.aborted) return
      this.send({ type: 'error', message: backendMessage(error, 'tts'), recoverable: true })
    } finally {
      if (this.ttsWork === control) this.ttsWork = null
    }
  }

  dispose() {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.authTimer)
    if (this.sttWork) this.sttWork.abort()
    if (this.ttsWork) this.ttsWork.abort()
    if (this.sessionId && this.plugin.leases.get(this.sessionId) === this)
      this.plugin.leases.delete(this.sessionId)
    try { this.ws.close() } catch { }
  }

  close() { this.dispose() }
}
