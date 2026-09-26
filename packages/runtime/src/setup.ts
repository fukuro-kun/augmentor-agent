// Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {ModelRuntime} from '@earendil-works/pi-coding-agent';
import {InMemoryCredentialStore} from '@earendil-works/pi-ai';
import {type Data,text} from '../../protocol/src/index.js';

// Pi's configuration strings support shell commands and environment expansion.
// The setup form accepts literal credentials only, including literal ! and $.
function literal(value:string){return value.replaceAll('$',()=>'$$').replace(/^!/,()=>'$!');}
function fingerprint(file:string){return createHash('sha256').update(existsSync(file)?readFileSync(file):'absent').digest('hex');}
export function connectionConfig(input:Data){
  if(input.images!==undefined&&typeof input.images!=='boolean')throw new Error('Wähle aus, ob das Modell Bilder verarbeitet.');
  const name=text(input.name,64).trim();
  const provider='augmentor-'+name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  if(provider==='augmentor-')throw new Error('Gib dieser Verbindung einen Namen mit Buchstaben oder Zahlen.');
  const model=text(input.model,200).trim();
  if(input.api!=='openai-completions')throw new Error('Das geführte Setup unterstützt derzeit OpenAI-kompatible Endpunkte.');
  let url:URL;try{url=new URL(text(input.baseUrl,2048).trim());}catch{throw new Error('Gib die vollständige URL des Modell-Endpunkts ein.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('Verwende einen HTTP- oder HTTPS-Endpunkt ohne Zugangsdaten, Query-Parameter oder Fragmente.');
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.protocol==='http:'&&!local)throw new Error('Entfernte Modell-Endpunkte müssen HTTPS verwenden.');
  const key=typeof input.apiKey==='string'?input.apiKey.trim():'';
  if(key.length>8192||/[\r\n\0]/.test(key))throw new Error('Gib einen gültigen API-Schlüssel ein.');
  if(!local&&!key)throw new Error('Gib einen API-Schlüssel für diesen entfernten Endpunkt ein.');
  for(const [field,min,max] of [['contextWindow',1024,10000000],['maxTokens',32,1000000]] as const){
    if(!Number.isSafeInteger(input[field])||input[field]<min||input[field]>max)throw new Error('Gib gültige Kontext- und Antwortlimits für das Modell ein.');
  }
  if(input.maxTokens>input.contextWindow)throw new Error('Das Antwortlimit muss in das Kontextfenster passen.');
  const config={name,baseUrl:url.href.replace(/\/$/,''),api:input.api,apiKey:literal(key||'augmentor-local-no-key'),
    models:[{id:model,name,reasoning:false,input:(input.images?['text','image']:['text']) as ('text'|'image')[],
      contextWindow:input.contextWindow,maxTokens:input.maxTokens,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]};
  return {provider,config,selection:{provider,model}};
}

export class SetupConnections {
  private active?:AbortController;
  private pending?:{token:string;hash:string;expires:number;config:Data;selection:Data};
  constructor(private readonly file:string){}
  cancel(){this.active?.abort();this.pending=undefined;return {cancelled:true};}
  async test(input:Data){
    if(this.active)throw new Error('Eine Verbindungsprüfung läuft bereits.');
    this.pending=undefined;
    const {provider,config,selection}=connectionConfig(input),hash=fingerprint(this.file);
    const existing:Data=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):{providers:{}};
    if(existing.providers?.[provider])throw new Error('Dieser Verbindungsname existiert bereits. Wähle einen anderen Namen oder bearbeite ihn unter „Modelle & Anbieter“.');
    const controller=new AbortController();this.active=controller;
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(12000)]);
    try{
      // An isolated SDK runtime cannot read the user's auth.json or execute tools.
      const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
      runtime.registerProvider(provider,config);
      const model=runtime.getModel(provider,selection.model);
      if(!model)throw new Error('Das konfigurierte Modell wurde nicht registriert.');
      const response=await runtime.completeSimple(model,{messages:[{role:'user',content:input.images?[{type:'text',text:'Reply with READY to verify this connection and test image input.'},{type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAPUlEQVR4nGOUSDvAQAp4PtOeJPVMJKkmA4xaMGrBqAWjFoxaQA3A+P//f5paMPSDaNSCUQtGLRi1YERYAACG9QY5AXbDzwAAAABJRU5ErkJggg=='}]:'Reply with READY to verify this connection.',timestamp:Date.now()}]},
        {signal,maxTokens:32,maxRetries:0,timeoutMs:10000,transport:'sse'});
      if(signal.aborted)throw new Error('Verbindungsprüfung abgebrochen oder Zeitüberschreitung.');
      if(response.stopReason==='error'||response.stopReason==='aborted'||!response.content.some(p=>p.type==='text'&&p.text.trim())){
        const message=response.errorMessage||'';
        if(/401|403|unauthoriz|invalid.*key/i.test(message))throw new Error('Der Anbieter hat die Zugangsdaten abgelehnt. Prüfe API-Schlüssel und Kontozugriff.');
        if(/404|not found/i.test(message))throw new Error('Endpunkt oder Modell wurde nicht gefunden. Prüfe Endpunkt-URL und Modell-ID.');
        throw new Error('Das Modell hat keinen Text zurückgegeben. Prüfe API-Format, Modell-ID und Dienststatus.');
      }
      const token=randomUUID();
      this.pending={token,hash,expires:Date.now()+600000,config:{...existing,providers:{...existing.providers,[provider]:config}},selection};
      return {token,selection,verified:input.images?['text','image-input']:['text'],message:input.images?'Verbindung hat Text und ein erzeugtes Testbild angenommen. Dies bescheinigt keine visuelle Schlussfolgerungsfähigkeit.':'Verbindung geprüft. Es wurden keine Dateien oder Verlaufsdaten gesendet.'};
    }catch(error){
      if(signal.aborted)throw new Error('Verbindungsprüfung abgebrochen oder Zeitüberschreitung.');
      // Do not echo arbitrary provider response bodies or credentials to logs/UI.
      const message=error instanceof Error?error.message:'';
      if(/^(Der Anbieter hat|Endpunkt oder Modell|Das Modell hat|Das konfigurierte)/.test(message))throw error;
      throw new Error('Verbindung fehlgeschlagen. Prüfe Endpunkt, API-Format, Modell-ID und Zugangsdaten.');
    }finally{this.active=undefined;}
  }
  checked(token:unknown){
    const item=this.pending;
    if(!item||token!==item.token||item.expires<Date.now())throw new Error('Führe die Verbindungsprüfung vor dem Speichern erneut aus.');
    if(item.hash!==fingerprint(this.file))throw new Error('Die Modelleinstellungen haben sich während des Setups geändert. Führe die Verbindungsprüfung erneut aus.');
    return item;
  }
  saved(){this.pending=undefined;}
}
