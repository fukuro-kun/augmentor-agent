// Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
const $=id=>document.getElementById(id);let identity=null,polling=false,deviceBusy=false,homeBusy=false,pendingActions=false;
const display=(id,text)=>$(id).textContent=text;
async function api(path,body){const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(identity?{'X-Home-CSRF':identity.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();if(!r.ok){const error=Error(data.error??'Home ist nicht erreichbar');error.status=r.status;throw error;}return data;}
const notice=error=>display('error',error.message);
function message(text){const item=document.createElement('article');item.textContent=text;$('messages').append(item);}
function button(text,fn){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=()=>Promise.resolve(fn()).catch(notice);return b;}
async function refresh(){const [health,actions]=await Promise.all([api('/health'),api('/actions')]);homeBusy=health.busy;pendingActions=actions.pending.length>0;display('status',`${health.model} · ${health.busy?'arbeitet':'verbunden'}`);$('actions').replaceChildren();for(const action of actions.pending){const row=document.createElement('article');row.textContent=`${action.tool}: ${action.status}\n${action.arguments??''}`;if(identity.role==='owner')row.append(button('Ich habe dieses Ergebnis geprüft',async()=>{await api('/actions/acknowledge',{action_id:action.id,outcome_reviewed:true});await refresh();}));$('actions').append(row);}if(identity.role==='owner'){const {clients}=await api('/clients');$('clients').replaceChildren();for(const client of clients.filter(c=>!c.revoked)){const row=document.createElement('div');row.textContent=`${client.name} · ${client.role} `;row.append(button('Widerrufen',async()=>{await api('/clients/revoke',{id:client.id});await start();}));$('clients').append(row);}}await loadControls();}
async function resume(){const id=sessionStorage.getItem('home-request');if(!id||polling)return;polling=true;$('send').disabled=true;try{while(sessionStorage.getItem('home-request')===id){const result=await api('/requests/'+encodeURIComponent(id));display('request-state',result.status);if(result.response){if(sessionStorage.getItem('home-device-request')){const action=JSON.parse(sessionStorage.getItem('home-device-request'));const outcome=`${action.name}: ${result.response.status==='completed'?'Gerät meldet '+({on:'Ein',off:'Aus'}[action.action]??action.action):result.response.reply}`;display('device-status',outcome);message(outcome);sessionStorage.removeItem('home-device-request');}else message(result.response.reply);sessionStorage.removeItem('home-request');break;}if(result.status==='interrupted'){sessionStorage.removeItem('home-device-request');message('Der Server wurde während dieser Anfrage gestoppt. Prüfe die Aktionsergebnisse vor einer weiteren Änderung.');sessionStorage.removeItem('home-request');break;}await new Promise(r=>setTimeout(r,1200));}}catch(error){notice(error);}finally{polling=false;$('send').disabled=false;await refresh().catch(notice);}}
async function start(){try{identity=await api('/identity');$('pairing').hidden=true;$('home').hidden=false;$('owner').hidden=identity.role!=='owner';display('error','');await refresh();await resume();}catch(error){if(error.status!==401){notice(error);return;}identity=null;$('pairing').hidden=false;$('home').hidden=true;display('status','Kopple diesen Browser mit deinem Zuhause');}}
$('pair').onsubmit=async e=>{e.preventDefault();try{await api('/pair',{...Object.fromEntries(new FormData(e.target)),kind:'browser'});e.target.elements.code.value='';await start();}catch(error){notice(error);}};
$('ask').onsubmit=async e=>{e.preventDefault();if(sessionStorage.getItem('home-request')){notice(Error('Hole das vorherige Ergebnis ab, bevor du eine weitere Anfrage sendest.'));await resume();return;}const prompt=e.target.elements.prompt.value;const request_id=crypto.randomUUID();let session_id=sessionStorage.getItem('home-session');if(!session_id){session_id=crypto.randomUUID();sessionStorage.setItem('home-session',session_id);}sessionStorage.setItem('home-request',request_id);message('Du: '+prompt);display('error','');$('send').disabled=true;try{const result=await api('/ask',{request_id,session_id,prompt,async:true});if(result.status==='accepted'){e.target.reset();await resume();}else{message(result.reply);sessionStorage.removeItem('home-request');}}catch(error){if([400,401,403,409,413,415,429].includes(error.status)){sessionStorage.removeItem('home-request');notice(error);return;}notice(Error(error.message+' — nutze „Aktualisieren“, um die bestehende Anfrage abzurufen; nicht erneut senden.'));}finally{$('send').disabled=false;}};
$('refresh').onclick=()=>start().catch(notice);$('stop').onclick=()=>api('/cancel',{}).then(()=>display('request-state','Stoppt; prüfe das Ergebnis.')).catch(notice);
$('logout').onclick=()=>api('/logout',{}).then(()=>{sessionStorage.clear();$('messages').replaceChildren();return start();}).catch(notice);
$('invite').onsubmit=async e=>{e.preventDefault();try{const result=await api('/clients/invite',Object.fromEntries(new FormData(e.target)));display('code',result.code+' — läuft in 10 Minuten ab; nur an die vorgesehene Person weitergeben.');}catch(error){notice(error);}};
start();

$('load-devices').onclick=async()=>{try{
 const {devices}=await api('/devices');$('devices').replaceChildren();
 for(const device of devices){
  const row=document.createElement('article');row.textContent=`${device.name} (${device.entity_id}) — ${device.state}`;
  const choice=document.createElement('select');choice.setAttribute('aria-label','Zugriff für '+device.entity_id);
  for(const [value,text] of [['off','Nicht verbunden'],['read','Nur lesen'],...(device.can_control?[['control','Steuern — Auswirkungen geprüft']]:[])]){const option=document.createElement('option');option.value=value;option.textContent=text;choice.append(option);}
  choice.value=device.selected?(device.control?'control':'read'):'off';choice.disabled=!device.selectable;row.append(choice);
  const save=button('Zugriff speichern',async()=>{await api('/devices/select',{entity_id:device.entity_id,enabled:choice.value!=='off',control:choice.value==='control',effects_reviewed:choice.value==='control'});display('error','Gerätezugriff gespeichert.');await refresh();});save.disabled=!device.selectable;row.append(save);$('devices').append(row);
 }
}catch(error){notice(error);}};

function modelInput(){const f=$('model-form').elements;return {model:f.model.value.trim(),modelUrl:f.modelUrl.value.trim(),contextWindow:Number(f.contextWindow.value),allowLanHttp:f.allowLanHttp.checked,...f.replaceKey.checked?{key:f.key.value}:{}};}
$('load-model').onclick=async()=>{try{const m=await api('/model'),f=$('model-form').elements;f.model.value=m.model;f.modelUrl.value=m.modelUrl;f.contextWindow.value=m.contextWindow;$('model-form').hidden=false;display('model-result','Die Zugangsdaten bleiben auf dem NAS. Automatischer Fallback ist deaktiviert.');}catch(error){notice(error);}};
$('discover-models').onclick=async()=>{try{const m=await api('/model/discover',modelInput());$('models').replaceChildren();for(const id of m.models){const option=document.createElement('option');option.value=id;$('models').append(option);}display('model-result',m.models.length+' Modell-IDs gefunden. Wähle eine ID; '+m.qualification);}catch(error){notice(error);}};
$('model-form').onsubmit=async e=>{e.preventDefault();try{await api('/model/save',modelInput());e.target.elements.key.value='';e.target.elements.replaceKey.checked=false;display('model-result','Gespeichert. Prüfe Text- und Werkzeugunterstützung mit einer reinen Leseanfrage.');await refresh();}catch(error){notice(error);}};

function deviceSession(){let id=sessionStorage.getItem('home-session');if(!id){id=crypto.randomUUID();sessionStorage.setItem('home-session',id);}return id;}
async function setDevice(device,action){
 if(deviceBusy||sessionStorage.getItem('home-request')){notice(Error('Hole die aktuelle Anfrage ab, bevor du etwas änderst.'));return;}
 deviceBusy=true;const request_id=crypto.randomUUID();
 sessionStorage.setItem('home-request',request_id);
 sessionStorage.setItem('home-device-request',JSON.stringify({name:device.name,action}));
 display('error','');display('device-status',device.name+': sende '+({on:'Ein',off:'Aus'}[action]??action)+'…');
 document.querySelectorAll('[data-device-action]').forEach(b=>b.disabled=true);
 try{
  await api('/device-actions',{request_id,session_id:deviceSession(),action:{entity_id:device.entity_id,action},async:true});
  await resume();
 }catch(error){
  if([400,401,403,409,413,415,429].includes(error.status)){sessionStorage.removeItem('home-request');sessionStorage.removeItem('home-device-request');notice(error);}
  else notice(Error('Verbindung unterbrochen. Nutze „Aktualisieren“, um diese Aktion abzurufen; sie wird nicht erneut gesendet.'));
 }finally{deviceBusy=false;await refresh().catch(notice);}
}
async function loadControls(){
 const {devices}=await api('/devices');$('device-controls').replaceChildren();$('device-readings').replaceChildren();$('readings-section').hidden=true;
 devices.sort((a,b)=>Number(['unavailable','unknown'].includes(a.state))-Number(['unavailable','unknown'].includes(b.state))||Number(!!b.control)-Number(!!a.control)||String(a.name??a.entity_id).localeCompare(String(b.name??b.entity_id)));
 if(!devices.length){const empty=document.createElement('p');empty.textContent='Noch keine Geräte verbunden. Füge deine vorhandenen Smart-Home-Integrationen in Home Assistant hinzu.';$('device-controls').append(empty);}
 for(const device of devices){
  const row=document.createElement('article');row.className='device-card';
  const name=document.createElement('h3');name.textContent=device.name??device.entity_id;row.append(name);
  const state=document.createElement('p');state.textContent='Gemeldeter Zustand: '+device.state+(device.unit?' '+device.unit:'');row.append(state);
  const detail=document.createElement('small');detail.textContent=device.entity_id;row.append(detail);
  const writable=device.can_control??/^(light|switch|input_boolean)\./.test(device.entity_id);
  if(writable){
   const controls=document.createElement('div');controls.className='toolbar';
   for(const [action,label] of [['on','Ein'],['off','Aus']]){
    const control=button(label,()=>setDevice(device,action));control.dataset.deviceAction=action;control.setAttribute('aria-label',label+' '+name.textContent);
    control.disabled=identity.role==='viewer'||!device.control||device.identity_changed||['unavailable','unknown'].includes(device.state)||deviceBusy||homeBusy||pendingActions||!!sessionStorage.getItem('home-request');controls.append(control);
   }
   row.append(controls);
   const help=document.createElement('p');help.className='device-help';
   help.textContent=device.identity_changed?'Die Geräteidentität hat sich geändert. Prüfe den Zugriff in den Einstellungen.':!device.control?'Die Steuerung wurde nicht aktiviert.':identity.role==='viewer'?'Dieser Browser hat nur Lesezugriff.':pendingActions?'Prüfe die unsichere Aktion vor einer weiteren Änderung.':['unavailable','unknown'].includes(device.state)?'Gerät ist nicht erreichbar. Aktualisiere, sobald es wieder verbunden ist.':'';
   if(help.textContent)row.append(help);
   if(identity.role==='owner'&&!device.control&&device.selectable){
    row.append(button('Steuerung aktivieren',async()=>{await api('/devices/select',{entity_id:device.entity_id,enabled:true,control:true,effects_reviewed:true});await refresh();}));
    const review=document.createElement('small');review.textContent='Erst aktivieren, nachdem geprüft wurde, was dieses Gerät versorgt und welche vorhandenen Automationen es auslöst.';row.append(review);
   }
  }else{const help=document.createElement('p');help.textContent='Nur lesen — dieses Gerät hat keine Ein-/Aus-Steuerung.';row.append(help);}
  if(writable)$('device-controls').append(row);else{$('readings-section').hidden=false;$('device-readings').append(row);}
 }
 $('discovery-section').hidden=true;$('discovered-devices').replaceChildren();
 if(identity.role==='owner'){
  const report=await api('/devices/discovered');$('discovered-devices').replaceChildren();$('discovery-section').hidden=!report.devices.length;
  display('discovery-status',report.scanned_at?'Letzte Netzwerkinventur: '+new Date(report.scanned_at).toLocaleString('de-DE')+'. Dies ist eine Erkennungsmomentaufnahme, kein Live-Gerätestatus.':'');
  for(const device of report.devices){const row=document.createElement('article');row.className='device-card';const name=document.createElement('h3');name.textContent=device.name;const detail=document.createElement('p');detail.textContent=[device.model,device.host].filter(Boolean).join(' · ');const status=document.createElement('p');status.textContent=device.status==='unsupported'?'Kompatibilitätseinrichtung erforderlich':'Konto- oder Integrationseinrichtung erforderlich';row.append(name,detail,status);for(const label of ['Ein','Aus']){const b=button(label,()=>{});b.disabled=true;b.setAttribute('aria-label',label+' '+device.name);row.append(b);}$('discovered-devices').append(row);}
 }
}
