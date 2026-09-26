// Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
// Restricted adapter over HA's existing REST services and entity registry.
import WebSocket from 'ws';
const valid=id=>typeof id==='string'&&/^(light|switch|input_boolean|sensor|binary_sensor)\.[a-z0-9_]+$/.test(id);
const fingerprint=e=>JSON.stringify([e.id,e.platform,e.config_entry_id,e.unique_id]);
function summary(state){return {entity_id:state.entity_id,name:String(state.attributes?.friendly_name??state.entity_id).slice(0,200),state:String(state.state).slice(0,200),brightness:state.attributes?.brightness??null,unit:state.attributes?.unit_of_measurement??null,last_updated:state.last_updated??null};}
export class Devices {
 constructor(config,db){this.url=new URL(config.mcpUrl).origin;this.token=config.haToken;this.db=db;db.exec('CREATE TABLE IF NOT EXISTS home_devices(entity TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, control INTEGER NOT NULL)');}
 async rest(path,body,signal){
  const response=await fetch(this.url+path,{method:body===undefined?'GET':'POST',redirect:'error',headers:{Authorization:'Bearer '+this.token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
  if(!response.ok){await response.body?.cancel();throw Error('Home-Assistant-Anfrage fehlgeschlagen ('+response.status+')');}
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2097152){await reader.cancel();throw Error('Das Home-Inventar überschreitet das unterstützte Antwortlimit');}chunks.push(value);}}finally{reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString());
 }
 registry(entity,signal){
  if(entity!==undefined&&!valid(entity))throw Error('Nicht unterstützte Entität');
  return new Promise((resolve,reject)=>{
   const ws=new WebSocket(this.url.replace(/^http/,'ws')+'/api/websocket',{maxPayload:2097152,handshakeTimeout:5000,followRedirects:false});let settled=false;
   const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);ws.terminate();error?reject(error):resolve(result);};
   const abort=()=>finish(Error('Home-Anfrage abgebrochen'));
   const timer=setTimeout(()=>finish(Error('Zeitüberschreitung der Home-Registrierung')),10000);
   if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
   ws.on('error',()=>finish(Error('Home-Registrierung nicht erreichbar')));ws.on('close',()=>finish(Error('Home-Registrierung getrennt')));
   ws.on('message',raw=>{try{const m=JSON.parse(raw);if(m.type==='auth_required')ws.send(JSON.stringify({type:'auth',access_token:this.token}));else if(m.type==='auth_ok')ws.send(JSON.stringify({id:1,type:entity?'config/entity_registry/get':'config/entity_registry/list',...(entity?{entity_id:entity}:{})}));else if(m.type==='auth_invalid')finish(Error('Authentifizierung der Home-Registrierung fehlgeschlagen'));else if(m.id===1)finish(m.success?null:Error('Entitätsidentität nicht verfügbar'),m.result);}catch{finish(Error('Ungültige Registrierungsantwort'));}});
  });
 }
 async inventory(){
  const [states,registry]=await Promise.all([this.rest('/api/states'),this.registry()]);
  if(!Array.isArray(states)||!Array.isArray(registry)||states.length>5000)throw Error('Nicht unterstütztes Home-Inventar');
  const entries=new Map(registry.map(e=>[e.entity_id,e]));
  return states.filter(s=>valid(s.entity_id)).map(s=>{const e=entries.get(s.entity_id),selected=this.db.prepare('SELECT control,fingerprint FROM home_devices WHERE entity=?').get(s.entity_id);return {...summary(s),selectable:!!e?.id&&!!e?.unique_id,selected:!!selected,identity_changed:!!selected&&(!e||fingerprint(e)!==selected.fingerprint),control:!!selected?.control&&!!e&&fingerprint(e)===selected.fingerprint,can_control:/^(light|switch|input_boolean)\./.test(s.entity_id)};});
 }
 async select(entity,enabled,control){
  if(!valid(entity)||typeof enabled!=='boolean'||typeof control!=='boolean')throw Error('Ungültige Geräteauswahl');
  if(!enabled){this.db.prepare('DELETE FROM home_devices WHERE entity=?').run(entity);return;}
  if(control&&!/^(light|switch|input_boolean)\./.test(entity))throw Error('Dieses Gerät unterstützt nur Lesezugriff');
  if(!this.db.prepare('SELECT entity FROM home_devices WHERE entity=?').get(entity)&&this.db.prepare('SELECT count(*) AS n FROM home_devices').get().n>=64)throw Error('Dieses Home-Profil unterstützt bis zu 64 ausgewählte Entitäten');
  const registry=await this.registry(entity);if(!registry?.id||!registry?.unique_id)throw Error('Eine stabil registrierte Entitätsidentität ist erforderlich');
  this.db.prepare('INSERT INTO home_devices VALUES(?,?,?) ON CONFLICT(entity) DO UPDATE SET fingerprint=excluded.fingerprint,control=excluded.control').run(entity,fingerprint(registry),control?1:0);
 }
 async read(entity,signal){
  if(!valid(entity))throw Error('Nicht unterstützte Entität');
  const selected=this.db.prepare('SELECT * FROM home_devices WHERE entity=?').get(entity);if(!selected)throw Error('Gerät ist für Home nicht aktiviert');
  const registry=await this.registry(entity,signal);if(fingerprint(registry)!==selected.fingerprint)throw Error('Die Geräteidentität hat sich geändert; der Besitzer muss sie prüfen');
  return {...summary(await this.rest('/api/states/'+entity,undefined,signal)),control:!!selected.control};
 }
 async list(signal){
  const result=[];for(const {entity} of this.db.prepare('SELECT entity FROM home_devices ORDER BY entity').all()){try{result.push(await this.read(entity,signal));}catch{if(signal?.aborted)throw Error('Home-Anfrage abgebrochen');result.push({entity_id:entity,state:'unavailable',control:false});}}return {devices:result};
 }
 async validate(args,signal){
  if(!args||Object.keys(args).some(k=>!['entity_id','action','brightness_pct'].includes(k))||!valid(args.entity_id)||!['on','off','brightness'].includes(args.action))throw Error('Nicht unterstützte Geräteaktion');
  if(args.action==='brightness'&&(!args.entity_id.startsWith('light.')||!Number.isInteger(args.brightness_pct)||args.brightness_pct<1||args.brightness_pct>100)||args.action!=='brightness'&&args.brightness_pct!==undefined)throw Error('Ungültige Helligkeit');
  const state=await this.read(args.entity_id,signal);if(!state.control||['unknown','unavailable'].includes(state.state))throw Error('Die Gerätesteuerung ist deaktiviert oder nicht verfügbar');
  return state;
 }
 async execute(args,signal){
  const domain=args.entity_id.split('.')[0];
  await this.rest('/api/services/'+domain+'/'+(args.action==='off'?'turn_off':'turn_on'),{entity_id:args.entity_id,...args.action==='brightness'?{brightness_pct:args.brightness_pct}:{}},signal);
  const observed=await this.read(args.entity_id,signal),expected=args.action==='off'?'off':'on';
  const matches=observed.state===expected&&(args.action!=='brightness'||Math.abs((observed.brightness??-1000)-args.brightness_pct*255/100)<=3);
  return {status:matches?'completed':'unknown',evidence:matches?'integration-state-observed':'acknowledged-without-matching-state',observed,physical_verification:false};
 }
}
