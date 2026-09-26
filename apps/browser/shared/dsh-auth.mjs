// Augmentor — dsh-augmentor plugin, pipe, and Chromium extension
// Copyright © 2026 Manolo Remiddi
// SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
// License: MIT with Augmentor Resale Restriction — see LICENSE at the repository root.

// Keep the DSH browser-session credential in the native host, never the
// extension or traces. The plugin authenticates this local client with its
// existing action-channel secret before supplying DSH's normal launch token.
export function createDshClient(base, actionToken) {
  const origin = new URL(base)
  if (!['http:', 'https:'].includes(origin.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) ||
      origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('DSH_AUGMENTOR_URL muss ein Loopback-HTTP(S)-Origin sein')
  }
  let cookie = ''
  let authenticating = null
  const headers = () => cookie ? { cookie } : {}
  const request = (route, options = {}) => fetch(`${origin.origin}${route}`, {
    ...options, redirect: 'manual',
    signal: options.signal ?? AbortSignal.timeout(10000),
  })

  async function authorize() {
    if (authenticating) return authenticating
    authenticating = (async () => {
      const probe = await request('/', { headers: headers() })
      await probe.body?.cancel()
      if (probe.status === 200) return
      if (probe.status !== 401) throw new Error(`DSH-Authentifizierungsprüfung fehlgeschlagen (HTTP ${probe.status})`)
      cookie = ''
      const bootstrap = await request('/api/augmentor/auth', {
        method: 'POST', headers: { 'x-augmentor-token': actionToken },
      })
      if (!bootstrap.ok) {
        await bootstrap.body?.cancel()
        throw new Error(`DSH-Authentifizierung fehlgeschlagen (HTTP ${bootstrap.status}); aktualisiere Augmentor-Plugin und -Extension, starte DSH neu und prüfe, dass beide dasselbe DSH_HOME verwenden`)
      }
      const { token } = await bootstrap.json()
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]+$/.test(token)) {
        throw new Error('Das DSH-Plugin hat kein gültiges Authentifizierungs-Token geliefert')
      }
      const exchange = await request(`/?token=${encodeURIComponent(token)}`)
      const sessionCookie = exchange.headers.getSetCookie()
        .find(value => /^dsh-auth-[A-Za-z0-9_-]+=/.test(value))?.split(';')[0]
      await exchange.body?.cancel()
      if (exchange.status !== 303 || !sessionCookie) throw new Error('DSH hat den Authentifizierungs-Token-Austausch abgelehnt')
      cookie = sessionCookie
    })().finally(() => { authenticating = null })
    return authenticating
  }

  return {
    async fetch(route, options = {}) {
      if (!route.startsWith('/api/') || route.includes('..') || route.includes('://')) throw new Error('Ungültige DSH-API-Route')
      const send = () => request(route, { ...options, headers: { ...options.headers, ...headers() } })
      const response = await send()
      if (response.status !== 401) return response
      // DSH rejects unauthenticated requests before dispatch. Only that
      // explicit rejection is retried; unknown outcomes are never replayed.
      await response.body?.cancel()
      await authorize()
      return send()
    },
    async websocketHeaders() { await authorize(); return headers() },
  }
}
