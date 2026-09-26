// Augmentor — DSH voice plugin over LAN InferenzQuelle
// Copyright © 2026 Manolo Remiddi
// SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
// License: MIT with Augmentor Resale Restriction — see LICENSE at the repository root.

// Minimal RIFF/WAVE codec for the voice contract. Encoding targets the STT
// upload (16 kHz mono int16); decoding validates the TTS response strictly —
// unexpected formats surface as errors instead of corrupt playback.

export function pcmToWav(pcm, rate = 16000) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 'latin1')
  header.write('fmt ', 12, 'latin1')
  header.writeUInt32LE(16, 16) // fmt chunk size
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36, 'latin1')
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

// Parses real RIFF chunks and returns the payload plus format facts. Rejects
// compressed, multi-channel, non-16-bit and unexpected sample rates — the
// playback contract is exactly 24 kHz mono int16.
export function wavToPcm(buffer, { rate = 24000 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 ||
      buffer.toString('latin1', 0, 4) !== 'RIFF' ||
      buffer.toString('latin1', 8, 12) !== 'WAVE')
    throw Error('invalid RIFF/WAVE container')
  let offset = 12, fmt = null, data = null
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('latin1', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const body = offset + 8
    if (body + size > buffer.length) break
    if (id === 'fmt ') fmt = buffer.subarray(body, body + size)
    else if (id === 'data') data = buffer.subarray(body, body + size)
    offset = body + size + (size & 1) // chunks are word-aligned
  }
  if (!fmt || fmt.length < 16) throw Error('missing fmt chunk')
  const format = fmt.readUInt16LE(0)
  const channels = fmt.readUInt16LE(2)
  const actualRate = fmt.readUInt32LE(4)
  const bits = fmt.readUInt16LE(14)
  if (format !== 1) throw Error(`compressed WAV format ${format}`)
  if (channels !== 1 || bits !== 16 || actualRate !== rate)
    throw Error(`unsupported WAV shape ${channels}ch ${bits}bit ${actualRate}Hz`)
  if (!data || data.length === 0 || data.length % 2 !== 0)
    throw Error('missing or odd audio payload')
  return { pcm: Buffer.from(data), rate: actualRate, channels, bits }
}
