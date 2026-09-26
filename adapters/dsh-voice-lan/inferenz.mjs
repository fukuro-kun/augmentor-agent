// Augmentor — DSH voice plugin over LAN InferenzQuelle
// Copyright © 2026 Manolo Remiddi
// SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
// License: MIT with Augmentor Resale Restriction — see LICENSE at the repository root.

// HTTP client for the OpenAI-compatible audio routes on the local
// InferenzQuelle forward (127.0.0.1:8012 → Janus → Acheron). Audio stays in
// memory; nothing is written to disk and payloads are never logged.
import { randomBytes } from 'node:crypto'
import { pcmToWav } from './wav.mjs'

export class VoiceBackendError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.status = status
  }
}

export class InferenzVoice {
  constructor({ base = 'http://127.0.0.1:8012', timeoutMs = 115000, sttModel = '', ttsModel = '', voice = '' } = {}) {
    Object.assign(this, { base: base.replace(/\/$/, ''), timeoutMs, sttModel, ttsModel, voice })
  }

  signal(outer) {
    return AbortSignal.any([outer, AbortSignal.timeout(this.timeoutMs)])
  }

  async request(path, init, outer) {
    let response
    try {
      response = await fetch(this.base + path, { ...init, signal: this.signal(outer) })
    } catch (error) {
      if (outer.aborted) throw error
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError')
        throw new VoiceBackendError('timeout', 504)
      throw new VoiceBackendError('unreachable', 502)
    }
    if (!response.ok) {
      let detail = ''
      try { detail = (await response.json())?.error?.message ?? '' } catch { }
      throw new VoiceBackendError(detail || `HTTP ${response.status}`, response.status)
    }
    return response
  }

  // pcm: Buffer of int16 mono PCM at 16 kHz. language: 'de'|'en'|null (auto).
  async transcribe(pcm, { language = null, model = this.sttModel, signal } = {}) {
    const wav = pcmToWav(pcm, 16000)
    const boundary = '----augmentor-voice-' + randomBytes(12).toString('hex')
    const field = (name, value) =>
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'latin1')
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="utterance.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
      'latin1')
    const parts = [head, wav, Buffer.from('\r\n', 'latin1')]
    if (model) parts.push(field('model', model))
    if (language) parts.push(field('language', language))
    parts.push(Buffer.from(`--${boundary}--\r\n`, 'latin1'))
    const response = await this.request('/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: Buffer.concat(parts),
    }, signal)
    let result
    try { result = await response.json() } catch { throw new VoiceBackendError('invalid JSON response', 502) }
    if (typeof result?.text !== 'string') throw new VoiceBackendError('missing transcript text', 502)
    return result.text.trim()
  }

  // Returns the raw WAV bytes produced for `text`.
  async speak(text, { voice = this.voice, model = this.ttsModel, speed = null, language = null, signal } = {}) {
    const payload = { input: text, response_format: 'wav' }
    if (voice) payload.voice = voice
    if (model) payload.model = model
    if (typeof speed === 'number' && Number.isFinite(speed) && speed !== 1) payload.speed = speed
    if (language) payload.language = language
    const response = await this.request('/v1/audio/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }, signal)
    return Buffer.from(await response.arrayBuffer())
  }
}
