// Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
// Audio stays in the common native engine. This transport owns one expiring UI lease.
import {spawn} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import os from 'node:os'

export function voicePython(root, env=process.env){
  if(env.AUGMENTOR_PYTHON)return env.AUGMENTOR_PYTHON
  try{
    const descriptor=JSON.parse(readFileSync(path.join(env.XDG_DATA_HOME??path.join(os.homedir(),'.local/share'),'augmentor/desktop.json'),'utf8'))
    if(path.resolve(descriptor.root)===path.resolve(root)&&typeof descriptor.python==='string')return descriptor.python
  }catch{}
  return 'python3'
}
export class BrowserVoice {
  constructor({ticket,submit,notify,spawnWorker=spawn,root=fileURLToPath(new URL('../../../',import.meta.url))}){
    Object.assign(this,{ticket,submit,notify,spawnWorker,root});this.active=null
  }
  async start({sessionId,id,handsFree=false,submitMode='auto'}){
    if(!/^[a-f0-9-]{36}$/.test(id??'')||typeof sessionId!=='string'||!['auto','review'].includes(submitMode))throw Error('Ungültige Sprach-Identität')
    if(this.active)throw Error('Sprache ist bereits aktiv. Schließe sie, bevor du eine weitere Sprachsitzung öffnest.')
    const worker=this.spawnWorker(voicePython(this.root),['-u',path.join(this.root,'services/voice/browser-client.py')],{
      stdio:['pipe','pipe','ignore'],env:{...process.env,AUGMENTOR_WINDOW_ID:'main'},
    })
    const active={id,sessionId,worker,submitted:new Set(),buffer:'',submitMode,handsFree};this.active=active
    const emit=event=>{if(this.active===active)this.notify({method:'voice.event',params:{id,sessionId,...event}})}
    worker.on('error',()=>{emit({type:'error',message:'Die gemeinsame Sprach-Engine konnte nicht starten. Prüfe die Companion-Installation.'});this.close(active)})
    worker.on('exit',()=>{emit({type:'state',state:'closed',closed:true,status:'Sprache getrennt'});this.close(active)})
    worker.stdin.on('error',()=>this.close(active))
    worker.stdout.on('data',data=>{
      active.buffer+=data.toString()
      if(active.buffer.length>65536){emit({type:'error',message:'Ungültige Sprachantwort'});this.close(active);return}
      for(let end;(end=active.buffer.indexOf('\n'))>=0;){
        const line=active.buffer.slice(0,end);active.buffer=active.buffer.slice(end+1)
        try{
          const event=JSON.parse(line)
          if(event.type==='transcript')void this.transcript(active,event).catch(()=>{})
          else emit(event)
        }catch{emit({type:'error',message:'Ungültige Sprachantwort'});this.close(active)}
      }
    })
    this.write(active,{action:'prepare',handsFree})
    // Return the lease immediately, so release/cancel/heartbeats work during preparation.
    void this.ticket(sessionId).then(ticket=>{
      if(this.active!==active)return
      if(ticket.protocol!=='augmentor-voice/1'||ticket.sessionId!==sessionId||!/^ws:\/\/(127\.0\.0\.1|\[::1\]):\d+\/api\/augmentor-voice\/ws$/.test(ticket.url))throw Error('Ungültiger Sprach-Endpunkt')
      this.write(active,{action:'start',ticket})
    }).catch(error=>{emit({type:'error',message:error.message});this.close(active)})
    return {id,sessionId}
  }
  write(active,value){if(this.active===active&&!active.worker.stdin.destroyed)active.worker.stdin.write(JSON.stringify(value)+'\n')}
  control({id,sessionId,action,settings}){
    const active=this.active
    if(!active||id!==active.id||sessionId!==active.sessionId)throw Error('Die Sprache gehört zu einer anderen oder geschlossenen Unterhaltung')
    if(!['heartbeat','begin','end','interrupt','close','settings'].includes(action))throw Error('Nicht unterstützte Sprachsteuerung')
    if(action==='close')this.close(active)
    else this.write(active,{action,...(action==='settings'&&settings&&typeof settings==='object'?{settings}:{})})
    return {ok:true}
  }
  observe(sessionId,event){if(this.active?.sessionId===sessionId)this.write(this.active,{action:'observe',event})}
  async transcript(active,event){
    if(this.active!==active||event.sessionId!==active.sessionId||!/^[-a-f0-9]{36}$/.test(event.requestId??'')||active.submitted.has(event.requestId))return
    if(typeof event.text!=='string'||!event.text.trim()||event.text.length>8192){this.close(active);return}
    active.submitted.add(event.requestId)
    if(active.submitMode==='review'&&!active.handsFree){this.notify({method:'voice.event',params:{id:active.id,sessionId:active.sessionId,type:'draft',requestId:event.requestId,text:event.text}});return}
    const id='augmentor-voice:'+event.requestId
    let result
    try{result=await this.submit(active.sessionId,id,event.text)}
    catch(error){result={accepted:false,error:'Das Ergebnis der Übermittlung ist unbekannt. Prüfe die Unterhaltung vor einem erneuten Versuch. '+error.message}}
    this.write(active,{action:'submission',result:{...result,id}})
  }
  close(active=this.active){
    if(!active||this.active!==active)return
    this.write(active,{action:'close'});this.active=null
    active.worker.stdin.end()
    const timer=setTimeout(()=>active.worker.kill(),2000);timer.unref?.()
    active.worker.once('exit',()=>clearTimeout(timer))
    this.notify({method:'voice.event',params:{id:active.id,sessionId:active.sessionId,type:'state',state:'closed',closed:true,status:'Sprache aus'}})
  }
}

export function voicePreferences(value,root=fileURLToPath(new URL('../../../',import.meta.url))){
  return new Promise((resolve,reject)=>{
    const child=spawn(voicePython(root),[path.join(root,'services/voice/preferences.py')],{stdio:['pipe','pipe','ignore'],env:{...process.env,AUGMENTOR_WINDOW_ID:'main'}})
    let output='';const timer=setTimeout(()=>{child.kill();reject(Error('Die Spracheinstellungen haben nicht geantwortet.'))},25000)
    child.on('error',error=>{clearTimeout(timer);reject(error)})
    child.stdin.on('error',()=>{})
    child.stdout.on('data',data=>{output+=data;if(output.length>1024*1024)child.kill()})
    child.on('close',code=>{clearTimeout(timer);try{const result=JSON.parse(output);if(code||result.error)throw Error(result.error??'Spracheinstellungen fehlgeschlagen');resolve(result)}catch(error){reject(error)}})
    child.stdin.end(JSON.stringify(value))
  })
}
