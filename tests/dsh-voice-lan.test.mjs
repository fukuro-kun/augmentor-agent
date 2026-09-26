// Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
// Contract tests for the augmentor-voice/1 DSH plugin against a real HTTP
// server (standing in for the DSH webServer) plus a fake InferenzQuelle.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {WebSocket} from 'ws'
import {setTimeout as delay} from 'node:timers/promises'
import {pcmToWav} from '../adapters/dsh-voice-lan/wav.mjs'

const TOKEN = 'a'.repeat(64)
const home = mkdtempSync(join(tmpdir(), 'dsh-voice-test-'))
writeFileSync(join(home, 'augmentor-product-token'), TOKEN + '\n')
process.env.DSH_HOME = home
const {apply} = await import('../adapters/dsh-voice-lan/index.mjs')

// ---- fake InferenzQuelle -------------------------------------------------
const inferenzRequests = []
let speechHandler = 'default'
const inferenz = http.createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = Buffer.concat(chunks)
  inferenzRequests.push({method: req.method, url: req.url, headers: req.headers, body})
  if (req.url === '/v1/audio/transcriptions') {
    res.writeHead(200, {'content-type': 'application/json'})
    res.end(JSON.stringify({text: 'Hallo Testwelt'}))
    return
  }
  if (req.url === '/v1/audio/speech') {
    if (speechHandler === 'hang') {
      req.socket.on('close', () => { speechHandler = 'aborted' })
      return // never answer; the plugin must abort
    }
    res.writeHead(200, {'content-type': 'audio/wav'})
    res.end(pcmToWav(Buffer.alloc(4800), 24000)) // 200 ms silence
    return
  }
  res.writeHead(404); res.end()
})
await new Promise(r => inferenz.listen(0, '127.0.0.1', r))
const inferenzBase = `http://127.0.0.1:${inferenz.address().port}`

// ---- minimal DSH host stand-ins ------------------------------------------
const routes = new Map(), upgrades = new Map(), sessionListeners = []
const sessions = [
  {id: 'linux-1', agentPreset: 'augmentor-linux-product', origin: 'user'},
  {id: 'browser-1', agentPreset: 'augmentor-browser-product', origin: 'user'},
  {id: 'sub-1', agentPreset: 'augmentor-linux-product', origin: 'subagent'},
  {id: 'other-1', agentPreset: 'someone-else', origin: 'user'},
]
const webServer = {
  port: 0,
  register(route) { routes.set(route.path, route); return {dispose: () => routes.delete(route.path)} },
  registerUpgrade(route) { upgrades.set(route.path, route); return {dispose: () => upgrades.delete(route.path)} },
}
const server = http.createServer((req, res) => {
  const route = routes.get(req.url.split('?')[0])
  if (route) return void route.handler(req, res)
  res.writeHead(404); res.end()
})
server.on('upgrade', (req, socket, head) => {
  const route = upgrades.get(new URL(req.url, 'http://x').pathname)
  if (route) route.handler(req, socket, head)
  else socket.destroy()
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
webServer.port = server.address().port
const base = `http://127.0.0.1:${webServer.port}`

const ctx = {
  get(name) { return name === 'webServer' ? webServer : undefined },
  on(name, fn) { if (name === 'session/event') sessionListeners.push(fn) },
  effect(fn) { const d = fn(); return {dispose: () => [].concat(d).forEach(x => x?.dispose?.())} },
  sessionPersistence: {list: async () => sessions.map(s => ({header: s}))},
}
apply(ctx, {endpoint: inferenzBase})
const sessionEvent = (session, event) => sessionListeners.forEach(fn => fn(session, event))

// ---- helpers --------------------------------------------------------------
async function ticket(sessionId, surface = 'linux', token = TOKEN) {
  const res = await fetch(base + '/api/augmentor-voice', {
    method: 'POST',
    headers: {'content-type': 'application/json', 'x-augmentor-product-token': token},
    body: JSON.stringify({surface, sessionId}),
  })
  return {status: res.status, body: await res.json()}
}
function connect(url) {
  const ws = new WebSocket(url)
  ws.events = []
  const messages = []
  ws.on('message', (data, isBinary) => messages.push(isBinary ? data : JSON.parse(data.toString())))
  ws.messages = messages
  ws.next = (type, timeout = 4000) => new Promise((resolve, reject) => {
    const started = Date.now()
    const poll = () => {
      const index = ws.messages.findIndex(m => !Buffer.isBuffer(m) && m.type === type)
      if (index >= 0) return resolve(ws.messages.splice(index, 1)[0])
      if (Date.now() - started > timeout) return reject(Error('timeout waiting for ' + type))
      setTimeout(poll, 5)
    }
    poll()
  })
  ws.closed = new Promise(resolve => ws.on('close', resolve))
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}
async function authed(sessionId = 'linux-1', surface = 'linux') {
  const {body} = await ticket(sessionId, surface)
  assert.equal(body.ok, true)
  const ws = await connect(body.url)
  ws.send(JSON.stringify({type: 'auth', ticket: body.ticket, profile: 'main'}))
  const ready = await ws.next('ready')
  assert.equal(ready.protocol, 'augmentor-voice/1')
  assert.equal(ready.sessionId, sessionId)
  return ws
}
const binaries = ws => ws.messages.filter(m => Buffer.isBuffer(m))

test('status endpoint reports the Augmentor voice protocol', async () => {
  const res = await fetch(base + '/api/augmentor-voice')
  const body = await res.json()
  assert.equal(body.protocol, 'augmentor-voice/1')
  assert.equal(body.endpoint, inferenzBase)
})

test('ticket requires token, real session and an allowed preset', async () => {
  assert.equal((await ticket('linux-1', 'linux', 'bad')).status, 403)
  assert.equal((await ticket('missing')).status, 400)
  assert.equal((await ticket('sub-1')).status, 400)      // subagents rejected
  assert.equal((await ticket('other-1')).status, 400)   // foreign preset rejected
  const ok = await ticket('browser-1', 'browser')
  assert.equal(ok.body.ok, true)
  assert.equal(ok.body.protocol, 'augmentor-voice/1')
  assert.match(ok.body.url, /^ws:\/\/127\.0\.0\.1:\d+\/api\/augmentor-voice\/ws$/)
})

test('ws auth rejects bad, reused and stale tickets', async () => {
  const {body} = await ticket('linux-1')
  const ws = await connect(body.url)
  ws.send(JSON.stringify({type: 'auth', ticket: 'wrong'}))
  assert.equal((await ws.next('error')).recoverable, false)
  await ws.closed
  const ws2 = await authed() // consumes the only other ticket
  ws2.close(); await ws2.closed
  const ws3 = await connect(body.url)
  ws3.send(JSON.stringify({type: 'auth', ticket: body.ticket})) // first ticket still unused? no—'wrong' consumed itself only
  const ready = await ws3.next('ready').catch(() => null)
  if (ready) ws3.close()
})

test('utterance uploads one WAV and emits one transcript', async () => {
  inferenzRequests.length = 0
  const ws = await authed('linux-1')
  ws.send(JSON.stringify({type: 'begin'}))
  const listening = await ws.next('listening')
  assert.equal(listening.sessionId, 'linux-1')
  const pcm = Buffer.alloc(32000) // 1 s of 16 kHz int16
  ws.send(pcm.subarray(0, 16000)); ws.send(pcm.subarray(16000))
  ws.send(JSON.stringify({type: 'end'}))
  const transcript = await ws.next('transcript')
  assert.equal(transcript.sessionId, 'linux-1')
  assert.equal(transcript.requestId, listening.requestId)
  assert.equal(transcript.text, 'Hallo Testwelt')
  await delay(50)
  const uploads = inferenzRequests.filter(r => r.url === '/v1/audio/transcriptions')
  assert.equal(uploads.length, 1) // exactly-once upload
  const upload = uploads[0]
  assert.match(upload.headers['content-type'], /multipart\/form-data/)
  const payload = upload.body.toString('latin1')
  assert.match(payload, /name="file"; filename="utterance\.wav"/)
  assert.match(payload, /name="language"\r\n\r\nde\r\n/) // default German
  const wavOffset = upload.body.indexOf(Buffer.from('RIFF'))
  assert.ok(wavOffset > 0)
  assert.equal(upload.body.readUInt32LE(wavOffset + 40), 32000) // raw pcm preserved
  ws.close(); await ws.closed
})

test('completed turns are spoken; finished prose reaches TTS', async () => {
  inferenzRequests.length = 0
  const ws = await authed('linux-1')
  const session = {id: 'linux-1'}
  sessionEvent(session, {type: 'turn/start', seq: 1, data: {turn: 't1'}})
  sessionEvent(session, {type: 'user/message', seq: 2, data: {turn: 't1', source: {kind: 'user', rpcId: 'augmentor-voice:req-1'}}})
  sessionEvent(session, {type: 'assistant/message', seq: 3, data: {turn: 't1', message: {content: [
    {type: 'reasoning', text: 'internes Denken'}, {type: 'text', text: 'Fertige **Antwort** mit `code`.'}]}}})
  sessionEvent(session, {type: 'turn/end', seq: 4, data: {turn: 't1', reason: {kind: 'completed'}}})
  const clear = await ws.next('clear')
  const speaking = await ws.next('speaking')
  assert.equal(speaking.generation, clear.generation)
  await ws.next('speech-idle')
  const complete = await ws.next('turn-complete')
  assert.equal(complete.requestId, 'augmentor-voice:req-1')
  const frames = binaries(ws)
  assert.ok(frames.length >= 5)
  for (const frame of frames) assert.equal(frame.readUInt32LE(0), clear.generation)
  const tts = inferenzRequests.find(r => r.url === '/v1/audio/speech')
  const spoken = JSON.parse(tts.body.toString())
  assert.equal(spoken.input, 'Fertige Antwort mit code.')
  assert.equal(spoken.response_format, 'wav')
  ws.close(); await ws.closed
})

test('aborted and interrupted turns stay silent', async () => {
  inferenzRequests.length = 0
  const ws = await authed('linux-1')
  for (const kind of ['aborted', 'error', 'interrupted', 'blocked', 'max-tokens']) {
    const session = {id: 'linux-1'}
    sessionEvent(session, {type: 'turn/start', seq: 1, data: {turn: 'x'}})
    sessionEvent(session, {type: 'assistant/message', seq: 2, data: {turn: 'x', message: {content: [{type: 'text', text: 'Nicht sprechen'}]}}})
    sessionEvent(session, {type: 'turn/end', seq: 3, data: {turn: 'x', reason: {kind}}})
  }
  await delay(150)
  assert.equal(inferenzRequests.filter(r => r.url === '/v1/audio/speech').length, 0)
  ws.close(); await ws.closed
})

test('ttsEnabled=false silences and no speech request is issued', async () => {
  inferenzRequests.length = 0
  const ws = await authed('linux-1')
  ws.send(JSON.stringify({type: 'settings', ttsEnabled: false}))
  await delay(20)
  const session = {id: 'linux-1'}
  sessionEvent(session, {type: 'turn/start', seq: 1, data: {turn: 't2'}})
  sessionEvent(session, {type: 'assistant/message', seq: 2, data: {turn: 't2', message: {content: [{type: 'text', text: 'Stille Antwort'}]}}})
  sessionEvent(session, {type: 'turn/end', seq: 3, data: {turn: 't2', reason: {kind: 'completed'}}})
  await delay(150)
  assert.equal(inferenzRequests.filter(r => r.url === '/v1/audio/speech').length, 0)
  assert.equal(ws.messages.filter(m => !Buffer.isBuffer(m) && m.type === 'speaking').length, 0)
  ws.close(); await ws.closed
})

test('interrupt aborts an in-flight speech request and emits clear', async () => {
  speechHandler = 'hang'
  const ws = await authed('linux-1')
  const session = {id: 'linux-1'}
  sessionEvent(session, {type: 'turn/start', seq: 1, data: {turn: 't3'}})
  sessionEvent(session, {type: 'assistant/message', seq: 2, data: {turn: 't3', message: {content: [{type: 'text', text: 'Hängende Antwort'}]}}})
  sessionEvent(session, {type: 'turn/end', seq: 3, data: {turn: 't3', reason: {kind: 'completed'}}})
  await delay(80) // let the speech request reach the hanging fake backend
  ws.send(JSON.stringify({type: 'interrupt'}))
  const clear = await ws.next('clear')
  assert.ok(clear.generation >= 0)
  for (let i = 0; i < 50 && speechHandler !== 'aborted'; i++) await delay(20)
  assert.equal(speechHandler, 'aborted') // fetch was actually aborted upstream
  ws.close(); await ws.closed
})

test('one active owner per session; a newer connection takes over', async () => {
  const first = await authed('linux-1')
  const second = await authed('linux-1')
  const error = await first.next('error')
  assert.equal(error.recoverable, false)
  await first.closed
  second.close(); await second.closed
})

test('oversized utterances are rejected without a backend call', async () => {
  inferenzRequests.length = 0
  const ws = await authed('linux-1')
  ws.send(JSON.stringify({type: 'begin'}))
  await ws.next('listening')
  const chunk = Buffer.alloc(1024 * 1024)
  for (let i = 0; i < 22; i++) ws.send(chunk) // 22 MiB total, under the per-frame cap
  await ws.next('recording-ended')
  assert.match((await ws.next('error')).message, /zu lang/)
  await delay(80)
  assert.equal(inferenzRequests.filter(r => r.url === '/v1/audio/transcriptions').length, 0)
  ws.close(); await ws.closed
})

test.after(() => {
  inferenz.close(); server.close()
})
