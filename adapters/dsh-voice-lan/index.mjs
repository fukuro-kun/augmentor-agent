// Augmentor — DSH voice plugin over LAN InferenzQuelle
// Copyright © 2026 Manolo Remiddi
// SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
// License: MIT with Augmentor Resale Restriction — see LICENSE at the repository root.

// augmentor-voice/1: Augmentor-owned speech contract. The plugin runs inside
// the DSH web server — tickets over the authenticated loopback HTTP route,
// sessions over a registered WebSocket upgrade, speech through the LAN
// InferenzQuelle forward. No extra port or service is introduced.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { RELEASE } from '../../dist/contracts/src/release.js'
import { WebSocketServer } from 'ws'
import { InferenzVoice } from './inferenz.mjs'
import { VoiceConnection } from './connection.mjs'
import { visibleText } from './prose.mjs'

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const PROTOCOL = 'augmentor-voice/1'
export const REQUEST_PREFIX = 'augmentor-voice:'
const TICKET_TTL_MS = 60000
const ALLOWED_PRESETS = new Set(['augmentor-linux-product', 'augmentor-browser-product'])

export const name = 'augmentor-voice-lan'
export const inject = ['sessionPersistence']

export function apply(ctx, config = {}) {
  const token = readFileSync(join(DSH_HOME, 'augmentor-product-token'), 'utf8').trim()
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error('Run Augmentor DSH setup and restart dsh-web.service')
  const inferenz = new InferenzVoice({
    base: config.endpoint ?? 'http://127.0.0.1:8012',
    timeoutMs: config.timeoutMs ?? 115000,
    sttModel: config.sttModel ?? '',
    ttsModel: config.ttsModel ?? '',
    voice: config.voice ?? '',
  })
  const plugin = {
    ctx,
    inferenz,
    tickets: new Map(), // ticket → {sessionId, surface, expires}
    leases: new Map(), // sessionId → VoiceConnection
    config: {
      maxUtteranceSeconds: config.maxUtteranceSeconds ?? 600,
      maxBufferedBytes: config.maxBufferedBytes ?? 20971520, // ~10.9 min of 16 kHz int16
      maxSpeechChars: config.maxSpeechChars ?? 6000,
    },
  }
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of plugin.tickets) if (entry.expires < now) plugin.tickets.delete(key)
  }, 15000)
  sweep.unref?.()
  ctx.on('dispose', () => {
    clearInterval(sweep)
    plugin.tickets.clear()
    for (const connection of [...plugin.leases.values()]) connection.dispose()
    plugin.leases.clear()
  })

  // Completed turns feed TTS while a voice lease is open. Only `completed`
  // ends are spoken — blocked, truncated, aborted and errored turns stay
  // silent, matching the contract's "finished visible prose" rule.
  ctx.on('session/event', (session, event) => {
    const connection = plugin.leases.get(session?.id)
    if (!connection || !connection.authed || connection.closed) return
    if (event.type === 'turn/start') {
      connection.pendingAnswer = null
      connection.pendingRpc = null
      return
    }
    if (event.type === 'user/message' && event.data?.source?.kind === 'user') {
      connection.pendingRpc = event.data.source.rpcId ?? null
      return
    }
    if (event.type === 'assistant/message') {
      const text = visibleText(event.data?.message)
      if (text) connection.pendingAnswer = {
        text, turn: event.data?.turn ?? null, rpcId: connection.pendingRpc ?? null,
      }
      return
    }
    if (event.type !== 'turn/end') return
    const answer = connection.pendingAnswer
    connection.pendingAnswer = null
    const kind = event.data?.reason?.kind ?? event.data?.reason
    if (kind === 'completed' && answer && (!answer.turn || answer.turn === event.data?.turn))
      void connection.speakAnswer(answer.text, { rpcId: answer.rpcId })
    else if (kind === 'aborted' || kind === 'interrupted' || kind === 'error')
      connection.interruptPlayback()
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 })
  ctx.on('dispose', () => wss.close())
  wss.on('connection', ws => new VoiceConnection(ws, plugin))

  const registerRoutes = webServer => ctx.effect(() => {
    const disposeRoute = webServer.register({
      kind: 'exact',
      path: '/api/augmentor-voice',
      handler: async (req, res) => {
        const answer = (code, data) => {
          res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          res.end(JSON.stringify(data))
        }
        let url
        try { url = new URL('http://' + req.headers.host) } catch {
          return answer(403, { ok: false, error: 'Host nicht erlaubt' })
        }
        const host = url.hostname.replace(/^\[|\]$/g, '')
        if (!isIP(host) || !(host === '::1' || host.startsWith('127.')) ||
            (req.headers.origin !== undefined && req.headers.origin !== url.origin))
          return answer(403, { ok: false, error: 'Host nicht erlaubt' })
        if (req.method === 'GET') {
          return answer(200, {
            name: 'augmentor-voice-lan',
            protocol: PROTOCOL,
            version: RELEASE.version,
            endpoint: inferenz.base,
            wsPath: '/api/augmentor-voice/ws',
            leases: plugin.leases.size,
          })
        }
        if (req.method !== 'POST' ||
            !String(req.headers['content-type'] ?? '').startsWith('application/json') ||
            !timingSafeEqual(hash(String(req.headers['x-augmentor-product-token'] ?? '')), hash(token)))
          return answer(403, { ok: false, error: 'Autorisierte JSON-Anfrage erforderlich' })
        try {
          const payload = JSON.parse(await collect(req))
          const surface = payload.surface === 'browser' ? 'browser'
            : payload.surface === 'linux' ? 'linux' : null
          if (!surface || typeof payload.sessionId !== 'string' || !payload.sessionId || payload.sessionId.length > 256)
            throw Error('Ungültige Anfrage')
          const sessions = (await ctx.sessionPersistence.list()).map(row => row.header)
          const row = sessions.find(entry => entry.id === payload.sessionId)
          if (!row || !ALLOWED_PRESETS.has(row.agentPreset) || row.origin === 'subagent')
            throw Error('Diese Unterhaltung gehört zu einer anderen Rolle')
          const ticket = randomBytes(16).toString('hex')
          plugin.tickets.set(ticket, { sessionId: row.id, surface, expires: Date.now() + TICKET_TTL_MS })
          answer(200, {
            ok: true,
            protocol: PROTOCOL,
            url: `ws://127.0.0.1:${webServer.port}/api/augmentor-voice/ws`,
            ticket,
            sessionId: row.id,
          })
        } catch (error) {
          answer(400, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })
    const disposeUpgrade = webServer.registerUpgrade({
      path: '/api/augmentor-voice/ws',
      handler(req, socket, head) {
        const remote = req.socket.remoteAddress
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote ?? '')) {
          socket.destroy()
          return
        }
        if (req.headers.origin !== undefined) {
          try {
            const originHost = new URL(req.headers.origin).hostname.replace(/^\[|\]$/g, '')
            if (!isIP(originHost) || !(originHost === '::1' || originHost.startsWith('127.'))) throw Error()
          } catch {
            socket.destroy()
            return
          }
        }
        wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
      },
    })
    return [disposeRoute, disposeUpgrade]
  }, 'augmentor-voice-lan: routes')

  const webServer = ctx.get('webServer')
  if (webServer) registerRoutes(webServer)
  else ctx.on('internal/service', (name, value) => {
    if (name === 'webServer') registerRoutes(value)
  })
}

function hash(value) {
  return createHash('sha256').update(value).digest()
}

async function collect(req, limit = 16384) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > limit) throw Error('Anfrage ist zu groß')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}
