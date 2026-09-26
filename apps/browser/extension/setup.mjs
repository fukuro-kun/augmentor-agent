// Augmentor — dsh-augmentor plugin, pipe, and Chromium extension
// Copyright © 2026 Manolo Remiddi
// SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
// License: MIT with Augmentor Resale Restriction — see LICENSE at the repository root.
import {presentSettingsForm} from './settings-form.mjs'
export function modelSetupDialog(doc,send,container){
  if(doc.querySelector('.model-setup'))return
  const make=(tag,text)=>{const e=doc.createElement(tag);if(text)e.textContent=text;return e}
  const dialog=make('dialog');dialog.className='shared-prompt-editor memory-dialog model-setup'
  const intro=make('p','Verbinde deinen eigenen OpenAI-kompatiblen Endpunkt. Die Verbindung wird mit Augmentor Agent geteilt. Die Prüfung sendet eine kurze Nachricht und, falls ausgewählt, ein generiertes Testbild — ohne Werkzeuge, Dateien oder Verlauf. Dein Anbieter kann dafür Kosten berechnen. Der Schlüssel wird unverschlüsselt in der privaten Benutzerkonfiguration gespeichert.')
  intro.textContent='Gib Endpunkt und Modell deines Anbieters ein. Prüfe die Verbindung und speichere dann.'
  const form=make('fieldset');form.append(make('legend','Pi-Modellverbindung'))
  const fields={}
  for(const [key,label,value,type,min,max] of [['name','Verbindungsname','My model','text'],['baseUrl','Endpunkt-URL','','url'],['apiKey','API-Schlüssel','','password'],['model','Modell-ID','','text'],['contextWindow','Kontextlimit (Tokens)',32768,'number',1024,10000000],['maxTokens','Antwortlimit (Tokens)',4096,'number',32,1000000]]){
    const l=make('label',label),e=make('input');e.type=type;e.value=value;e.setAttribute('aria-label',label);if(min)e.min=min;if(max)e.max=max;l.append(e);form.append(l);fields[key]=e
  }
  fields.baseUrl.placeholder='https://dein-anbieter.example/v1';fields.apiKey.placeholder='Optional für ein Modell auf diesem Computer'
  const imageLabel=make('label','Modell akzeptiert Bilder'),images=make('input');images.type='checkbox';images.setAttribute('aria-label','Modell akzeptiert Bilder');imageLabel.append(images);form.append(imageLabel);fields.images=images
  const mode=make('select');mode.setAttribute('aria-label','Freigabemodus')
  for(const [value,label] of [['workspace-write','Vor Änderungen fragen'],['read-only','Nur lesen'],['danger-full-access','Aktionen ohne Nachfrage erlauben']]){const o=make('option',label);o.value=value;mode.append(o)}
  const modeLabel=make('label','Freigabemodus');modeLabel.append(mode);form.append(modeLabel)
  const explanation=make('p');form.append(explanation)
  mode.onchange=()=>{explanation.textContent={ 'workspace-write':'Routine-Beobachtungen laufen direkt. Aktionen, die Dateien oder Anwendungen ändern können, erfordern eine Freigabe.', 'read-only':'Werkzeuge, die Zustände ändern können, sind blockiert. Das ist eine Werkzeug-Richtlinie, keine Betriebssystem-Sandbox.', 'danger-full-access':'Werkzeuge handeln in ihrer Umgebung ohne weitere Freigabe. Stopp bleibt verfügbar.'}[mode.value]};mode.onchange()
  const note=make('p','Gib die Limits ein, die dein Anbieter veröffentlicht. Wähle Bildeingabe für Desktop-Screenshots. Dies prüft akzeptierte Formate; visuelles Reasoning erfordert separaten Test.'),actions=make('div')
  let token=null,busy=false,saving=false,closed=false
  const button=(label,fn)=>{const b=make('button',label);b.type='button';b.onclick=fn;actions.append(b);return b}
  const request=async(action,params={})=>{const r=await send('modelSetup',{action,params});if(!r.ok)throw Error(r.error);return r.result}
  const controls=()=>{form.disabled=busy;check.disabled=busy;save.disabled=busy||!token;later.disabled=saving}
  const run=async(fn)=>{busy=true;controls();try{await fn()}catch(e){if(!closed)note.textContent=e.message}finally{busy=false;saving=false;if(!closed)controls()}}
  for(const e of Object.values(fields))e.oninput=()=>{token=null;controls()}
  const later=button('Später',()=>dialog.close())
  const check=button('Verbindung prüfen',()=>run(async()=>{
    token=null;note.textContent='Die Modellverbindung wird geprüft…'
    const p=Object.fromEntries(Object.entries(fields).map(([k,e])=>[k,e.type==='checkbox'?e.checked:e.type==='number'?Number(e.value):e.value]));p.api='openai-completions'
    const result=await request('test',p);if(closed)return;token=result.token;note.textContent='Verbindung geprüft. Speichern, um dieses Modell zu nutzen.'
  }))
  const save=button('Speichern und Modell nutzen',()=>{saving=true;return run(async()=>{await request('save',{token,approvalMode:mode.value});dialog.close()})})
  if(container){
    const detail=make('details'),summary=make('summary','Erweitert');detail.className='advanced';detail.append(summary)
    for(const key of ['name','contextWindow','maxTokens','images'])detail.append(fields[key].parentElement)
    detail.append(modeLabel,explanation);form.append(detail)
    note.textContent='Verbindungsprüfungen senden eine kurze Testanfrage an deinen Anbieter.'
  }
  dialog.append(make('h3','Modell verbinden · Pi'),intro,form,note,actions);doc.body.append(dialog)
  dialog.addEventListener('cancel',e=>{if(saving)e.preventDefault()})
  dialog.addEventListener('close',()=>{closed=true;fields.apiKey.value='';if(!saving)void request('cancel').catch(()=>{});dialog.remove()})
  presentSettingsForm(dialog,container);controls();return dialog
}
