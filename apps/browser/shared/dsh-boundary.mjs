// Augmentor — dsh-augmentor plugin, pipe, and Chromium extension
// Copyright © 2026 Manolo Remiddi
// SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
// License: MIT with Augmentor Resale Restriction — see LICENSE at the repository root.
import {isIP} from 'node:net'
export const BROWSER_PRESET='augmentor-browser-product'
export const PERSONAL_PRESETS=new Set([BROWSER_PRESET,'augmentor-linux-product'])
export function loopbackEndpoint(value){
  const u=new URL(value),host=u.hostname.replace(/^\[|\]$/g,'')
  if(u.protocol!=='http:'||!isIP(host)||!(host==='::1'||host.startsWith('127.'))||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('Verbinde DSH über eine numerische Loopback-HTTP-URL.')
  return u.origin
}
export async function boundedJson(url,options={},limit=16*1024*1024){
  const response=await fetch(url,{...options,redirect:'error',signal:options.signal??AbortSignal.timeout(15000)})
  if(!response.ok)throw Error('DSH meldete HTTP '+response.status)
  const chunks=[];let bytes=0
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>limit)throw Error('Die DSH-Antwort überschreitet das Vorschau-Größenlimit.');chunks.push(chunk)}
  return JSON.parse(Buffer.concat(chunks).toString())
}
// Voice controls can only address the bridge's existing nonce-bound lease; they
// do not acquire a session or submit text. Avoid fetching all histories per heartbeat.
const independent=new Set(['augmentor/surface','augmentor/home','augmentor/voice/control','augmentor/dsh','augmentor/prompts','augmentor/memory','augmentor/diagnostics','updates/check','shutdown'])
const methods=new Set(['augmentor/voice/preferences','augmentor/interaction','augmentor/voice','augmentor/voice/start','augmentor/voice/control','augmentor/models','initialize','augmentor/state','augmentor/save','augmentor/unsave','session.list','session.create','session.selectModel','session.models','session.history','session.prompt','session.cancel','session.rename','session.branch','settings.describe','settings.mutate'])
const settings=new Set(['permission','model-picker-augmented'])
export class DshBoundary{
  constructor(call,handshake){this.call=call;this.handshake=handshake;this.known=new Set()}
  async sessions(){const result=await this.call('session.list',{});this.existing=new Set(result.items.map(row=>row.sessionId));const rows=result.items.filter(row=>PERSONAL_PRESETS.has(row.agentPreset) && row.origin!=='subagent');this.known=new Set(rows.map(r=>r.sessionId));return {...result,items:rows}}
  async owns(sessionId){if(typeof sessionId!=='string')return false;if(this.known.has(sessionId))return true;await this.sessions();return this.known.has(sessionId)}
  async guard(method,p={}){
    if(independent.has(method))return p
    if(!methods.has(method))throw Error('Diese Operation ist über die Augmentor-Browseroberfläche nicht verfügbar.')
    const info=await this.handshake()
    if(method==='session.create'){
      if(!/^[A-Za-z0-9_.-]{1,160}$/.test(p.sessionId??''))throw Error('Ungültige Browser-Chat-Identität.')
      if((await this.call('session.list',{})).items.some(row=>row.sessionId===p.sessionId))throw Error('Dieser Chat existiert bereits. Lade neu, bevor du fortfährst.')
      return {sessionId:p.sessionId,cwd:info.chatCwd,agentPreset:BROWSER_PRESET}
    }
    if((method.startsWith('session.')&&method!=='session.list')||['augmentor/interaction','augmentor/save','augmentor/unsave','augmentor/voice','augmentor/voice/start','augmentor/voice/control'].includes(method)){
      // Refresh on every explicit operation; a removed/replaced session must
      // not inherit a cached permission from its previous identity.
      await this.sessions()
      if(!this.known.has(p.sessionId))throw Error(this.existing.has(p.sessionId)?'Dieser Chat gehört zu einer anderen Augmentor-Rolle.':'Chat nicht gefunden.')
    }
    if(method.startsWith('settings.')){
      if(!settings.has(p.ns))throw Error('Hier sind nur Augmentor-Freigabe- und Modellauswahl-Einstellungen verfügbar.')
      if(method==='settings.mutate'){
        const ops=p.ops
        const allowed=p.ns==='permission'?['defaultPreset']:['pinned','hidden']
        if(!Array.isArray(ops)||!ops.length||ops.some(o=>o.op!=='set'||!Array.isArray(o.path)||o.path.length!==1||!allowed.includes(o.path[0])))throw Error('Nicht unterstützte Augmentor-Einstellungsänderung.')
        if(p.ns==='permission'&&ops.some(o=>!['workspace-write','read-only','danger-full-access'].includes(o.value)))throw Error('Nicht unterstützter Freigabemodus.')
      }
    }
    return p
  }
}
