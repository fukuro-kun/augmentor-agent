import {refreshDesktopAppearance} from './appearance.mjs'
// Augmentor — dsh-augmentor plugin, pipe, and Chromium extension
// Copyright © 2026 Manolo Remiddi
// SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
// License: MIT with Augmentor Resale Restriction — see LICENSE at the repository root.
import {homeSettings} from './home.mjs'

import {formattingFields, formattingDefaults, appearanceFields, readAppearance, saveAppearance, resetAppearance, watchAppearance} from './appearance.mjs'
import {modelSetupDialog} from './setup.mjs'
import {dshSetupDialog} from './dsh-setup.mjs'
import {memoryDialog} from './memory.mjs'
import {promptEditor} from './prompt-editor.mjs'
import {supportDialog} from './support.mjs'

const send=(type,payload={})=>chrome.runtime.sendMessage({type,...payload})
const make=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e}
const error=document.querySelector('#page-error')
const fail=e=>{error.hidden=false;error.textContent=e.message||String(e)}
const button=(parent,label,fn)=>{const b=make('button',label);b.type='button';b.onclick=()=>Promise.resolve().then(fn).catch(fail);parent.append(b);return b}
let state={},checking=false,closed=false
const sections=new Map()
const definitions=[
  ['voice','Sprache','Geteilt mit dem schwebenden Augmentor-Fenster.','M9 3h6v10H9zM5 10v3a7 7 0 0 0 14 0v-3M12 20v3'],
  ['appearance','Farben','Änderungen gelten sofort.','M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4 2 2 0 0 1 1-4h2a4 4 0 0 0 4-4c0-3-4-6-9-6ZM7 10h.01M10 6h.01M15 6h.01'],
  ['models','Modelle','Wähle das Modell, das Augmentor nutzt.','M9 3v6m6-6v6M6 9h12v2a6 6 0 0 1-12 0ZM12 17v4'],
  ['harnesses','Harnesses','Wähle, was deinen Browser-Agenten antreibt.','M4 7h16M4 17h16M8 4v6m8 4v6'],
  ['prompts','Prompt-Bibliothek','Wiederverwendbare Prompts, geteilt mit Augmentor Agent und beiden Harnesses. Tippe / im Chat, um einen zu nutzen.','M5 3h14v18H5zM8 8h8M8 12h8M8 16h4'],
  ['home','Home','Verbinde dein NAS und nutze Home in deinen Augmentor-Unterhaltungen.','M3 10l9-7 9 7v11H3z'],
  ['memory','Erinnerungen','Geteilt zwischen deinen Browser- und Linux-Agenten.','M4 5c0-4 16-4 16 0s-16 4-16 0v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0'],
  ['support','Support','Versionsinformationen und ein Bericht, den du vor dem Teilen prüfen kannst.','M12 11v6m0-10v1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0'],
]
for(const [id,label,description,path] of definitions){
  const link=make('a');link.href='#'+id;link.id='nav-'+id
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true')
  const shape=document.createElementNS(svg.namespaceURI,'path');shape.setAttribute('d',path);svg.append(shape);link.append(svg,document.createTextNode(label));document.querySelector('nav').append(link)
  const section=make('section');section.id='section-'+id;section.hidden=true;section.setAttribute('aria-labelledby','heading-'+id)
  const heading=make('h1',label);heading.id='heading-'+id
  const intro=make('p',description);intro.className='description';const body=make('div');body.className='section-body';section.append(heading,intro,body);document.querySelector('#sections').append(section)
  sections.set(id,{section,body,link,mounted:false})
}
document.querySelector('#version').textContent='Version '+chrome.runtime.getManifest().version
async function appearance(container){
  await refreshDesktopAppearance()
  const theme=make('div');theme.className='card';theme.append(make('h2','Design'));const choices=make('div');choices.className='theme-choices';theme.append(choices)
  const themeButtons={};for(const id of ['dark','light'])themeButtons[id]=button(choices,id==='dark'?'Dunkel':'Hell',async()=>{await saveAppearance({...readAppearance(),theme:id});sync()})
  const colours=make('div');colours.className='card';colours.append(make('h2','Farben'));const grid=make('div');grid.className='colour-grid';colours.append(grid)
  const controls=new Map()
  for(const [key,,label,min,max] of appearanceFields){
    const row=make('label',label),out=make('output'),input=make('input');input.type='range';input.min=min;input.max=max;input.step=1;input.id=key;input.setAttribute('aria-label',label);out.htmlFor=key
    input.oninput=()=>{saveAppearance({...readAppearance(),[key]:Number(input.value)}).catch(fail);sync()}
    row.append(out,input);grid.append(row);controls.set(key,{input,out})
  }
  const format=make('div');format.className='card formatting-colours';format.append(make('h2','Formatierungsfarben'))
  const formatControls=new Map()
  for(const [key,label] of formattingFields){
    const row=make('label',label),input=make('input');input.type='color';input.setAttribute('aria-label',label)
    input.oninput=()=>{const value=readAppearance();saveAppearance({...value,formatColours:{...value.formatColours,[key]:input.value}}).catch(fail)}
    row.append(input);format.append(row);formatControls.set(key,input)
  }
  const preview=make('div');preview.className='card';preview.append(make('h2','Vorschau'));const sample=make('div');sample.className='preview'
  const user=make('p','Hilf mir, das klarer zu machen.');user.className='sample-user';const reply=make('div');reply.className='sample-agent';reply.append(make('strong','Augmentor'),make('p','Etwas weniger Unordnung. Mehr Raum für deine Ideen.'));sample.append(user,reply);preview.append(sample)
  const note=make('p','Geteilt mit dem schwebenden Fenster. Der Akzent färbt auch Browser-Aktionen.');note.className='help';colours.append(note)
  container.append(theme,colours,format,preview);button(container,'Farben zurücksetzen',async()=>{await saveAppearance(resetAppearance());sync()})
  function sync(){const values=readAppearance();for(const [key,input] of formatControls)input.value=values.formatColours[key]||formattingDefaults(values.theme)[key];for(const [key,{input,out}] of controls){input.value=values[key];out.value=String(values[key])}for(const [id,b] of Object.entries(themeButtons))b.setAttribute('aria-pressed',String(values.theme===id))}
  watchAppearance(sync)
}
function advanced(parent,label){const detail=make('details');detail.className='advanced';detail.append(make('summary',label));const body=make('div');body.className='advanced-body';detail.append(body);parent.append(detail);return body}
function showModels(container){
  const active=make('p');active.id='active-model';container.append(active)
  const pi=make('div');pi.id='pi-model-settings';const dsh=make('div');dsh.id='dsh-model-settings';dsh.className='card';dsh.append(make('h2','DeepSeek-Harness-Modelle'),make('p','DSH verwaltet seine Modellanbieter. Füge sie in DSH hinzu oder bearbeite sie dort und aktualisiere dann die Modellauswahl in Augmentor.'))
  button(dsh,'DSH-Modelleinstellungen öffnen',async()=>{const r=await send('promptSettings');if(!r.ok)throw Error(r.error)})
  container.append(pi,dsh)
  const mountPi=()=>{const body=advanced(pi,'Weiteres Modell verbinden');if(!state.model?.model)body.parentElement.open=true;const dialog=modelSetupDialog(document,send,body);dialog?.addEventListener('close',()=>{if(closed)return;const note=make('p','Modell gespeichert. Wähle ein bestehendes Modell über die Modellauswahl im Chat oder verbinde unten ein weiteres.');note.className='saved-note';pi.replaceChildren(note);mountPi()},{once:true})}
  container.update=()=>{
    pi.hidden=state.harness!=='pi';dsh.hidden=state.harness!=='dsh'
    active.textContent='Aktuelles Modell: '+(state.model?.model||'Nicht verbunden')
    if(state.harness==='pi'&&!pi.querySelector('.model-setup'))mountPi()
  };container.update()
}
function showHarnesses(container){
  const card=make('div');card.className='card';card.append(make('h2','Browser-Harness'))
  const select=make('select');select.setAttribute('aria-label','Browser-Harness');for(const [value,label] of [['','DSH oder Pi wählen'],['pi','Pi'],['dsh','DeepSeek Harness']]){const opt=make('option',label);opt.value=value;opt.disabled=!value;select.append(opt)}
  select.onchange=async()=>{select.disabled=true;try{const r=await send('harness/select',{harness:select.value});if(!r.ok)throw Error(r.error);await refresh()}catch(e){fail(e)}finally{select.disabled=!!state.running}}
  card.append(select);container.append(card)
  const connection=advanced(container,'DSH-Verbindungseinstellungen')
  const mount=()=>{const dialog=dshSetupDialog(document,send,connection);dialog?.addEventListener('close',()=>{if(!closed){connection.replaceChildren(make('p','DSH-Verbindung gespeichert.'));mount()}},{once:true})};mount()
  container.update=()=>{select.value=state.harness||'';select.disabled=!!state.running};container.update()
}
function showMemory(container){
  const card=make('div');card.className='card onboarding-card';card.append(make('h2','Augmentor die Erinnerungen einrichten lassen'),make('p','Starte eine geführte Unterhaltung. Augmentor prüft deinen Computer und übernimmt die Einrichtung; es fragt nur nach fehlenden Angaben oder Zugangsdaten.'))
  const status=make('p');status.className='help';status.setAttribute('role','status')
  const start=button(card,'Mit Augmentor einrichten',async()=>{
    start.disabled=true;status.textContent='Augmentor Agent wird geöffnet…'
    const requestId=sessionStorage.getItem('memory-onboarding-id')||crypto.randomUUID();sessionStorage.setItem('memory-onboarding-id',requestId)
    try{const r=await send('onboarding/start',{topic:'memory',requestId});if(!r?.ok)throw Error(r?.error||'Einrichtung konnte nicht geöffnet werden');status.textContent='In Augmentor Agent fortfahren.';start.textContent='Einrichtung fortsetzen'}
    catch(e){status.textContent=e.message}
    finally{start.disabled=false}
  });card.append(status);container.append(card)
  const manual=advanced(container,'Erweitert · manuelle Einrichtung und gespeicherte Erinnerungen')
  // Mount on demand: opening Memories should not ask for technical inputs.
  manual.parentElement.addEventListener('toggle',()=>{if(manual.parentElement.open&&!manual.querySelector('dialog'))memoryDialog(document,send,()=>({surface:'browser',harness:state.harness,...(state.sessionId?{sessionId:state.sessionId}:{})}),manual)})
}
async function showVoice(container){
  const response=await send('voice/preferences');if(!response?.ok)throw Error(response?.error||'Sprachfunktion ist nicht verfügbar')
  const data=response.result,fields={}
  const add=(key,label,input)=>{const row=make('label',label);row.append(input);container.append(row);fields[key]=input;return input}
  const enabled=add('enabled','Sprachfunktion aktivieren',make('input'));enabled.type='checkbox';enabled.checked=data.enabled
  const ttsEnabled=add('ttsEnabled','Antworten vorlesen, solange Voice geöffnet ist',make('input'));ttsEnabled.type='checkbox';ttsEnabled.checked=data.ttsEnabled!==false
  const language=add('sttLanguage','Sprache der Spracherkennung',make('select'))
  for(const [value,label] of [['de','Deutsch'],['en','Englisch'],['auto','Automatisch erkennen']]){const option=make('option',label);option.value=value;language.append(option)}language.value=data.sttLanguage||'de'
  const voices=add('voiceId','Sprechstimme',make('select'))
  for(const row of data.voices){const option=make('option',row.name);option.value=row.id;voices.append(option)}voices.value=data.values.voiceId
  for(const [key,label,min,max,step,value] of [['speed','Sprechgeschwindigkeit',.5,2,.05,data.values.speed],['volume','Ausgabelautstärke',0,1,.05,data.values.volume],['pauseMs','Pause vor dem Senden (Freisprechen, Millisekunden)',400,10000,50,data.pauseMs],['dictationPauseMs','Pause pro Abschnitt (Diktat, gesperrt — Millisekunden)',400,10000,50,data.dictationPauseMs]]){
    const input=add(key,label,make('input'));input.type='number';input.min=min;input.max=max;input.step=step;input.value=value
  }
  const mode=add('mode','Unterhaltungsmodus',make('select'))
  for(const [value,label] of [['manual','Halten oder zum Sperren schieben'],['hands-free','Freisprech-Unterhaltung']]){const option=make('option',label);option.value=value;mode.append(option)}mode.value=data.mode
  const submitMode=add('submitMode','Nach dem Diktat',make('select'))
  for(const [value,label] of [['auto','Transkript sofort senden'],['review','Ins Eingabefeld legen']]){const option=make('option',label);option.value=value;submitMode.append(option)}submitMode.value=data.submitMode||'auto'
  const note=make('p','Halten zum Aufnehmen · Nach links schieben zum Sperren · Nach rechts für Freisprechen · Escape bricht ab. Änderungen gelten beim nächsten Öffnen der Sprachfunktion.');container.append(note)
  button(container,'Speichern',async()=>{
    const settings={voiceId:voices.value,enabled:enabled.checked,ttsEnabled:ttsEnabled.checked,sttLanguage:language.value,mode:mode.value,submitMode:submitMode.value,speed:Number(fields.speed.value),volume:Number(fields.volume.value),pauseMs:Number(fields.pauseMs.value),dictationPauseMs:Number(fields.dictationPauseMs.value)}
    const reply=await send('voice/preferences',{action:'save',settings});if(!reply?.ok)throw Error(reply?.error||'Spracheinstellungen konnten nicht gespeichert werden')
    note.textContent='Für beide Oberflächen gespeichert. Änderungen gelten beim nächsten Öffnen der Sprachfunktion.'
  })
}
function mount(id){
  const row=sections.get(id);if(row.mounted)return
  if(id!=='appearance'&&!['ready','needs-setup'].includes(state.phase)){
    row.body.textContent=state.error||'Verbinde mit dem Augmentor-Begleitprogramm… Die Einstellungen erscheinen hier, sobald es verfügbar ist.'
    return
  }
  row.body.replaceChildren();row.mounted=true
  if(id==='appearance')void appearance(row.body).catch(fail)
  if(id==='models')showModels(row.body)
  if(id==='harnesses')showHarnesses(row.body)
  if(id==='prompts')promptEditor(document,async request=>{const r=await send('prompts',{request});if(!r?.ok)throw Error(r?.error||'Prompt-Bibliothek nicht verfügbar');return r.library},()=>{},row.body)
  if(id==='home')homeSettings(document,send,row.body)
  if(id==='memory')showMemory(row.body)
  if(id==='voice')void showVoice(row.body).catch(fail)
  if(id==='support'){
    const version=make('div');version.className='card';version.append(make('h2','Augmentor '+chrome.runtime.getManifest().version),make('p','Diese Vorschau wird mit dem Augmentor-Installer aktualisiert. Begleitprogramm und Erweiterung müssen übereinstimmende Versionen nutzen.'));row.body.append(version)
    void supportDialog(document,send,row.body).catch(fail)
  }
}
function navigate(){
  const id=sections.has(location.hash.slice(1))?location.hash.slice(1):'appearance'
  for(const [key,row] of sections){row.section.hidden=key!==id;if(key===id)row.link.setAttribute('aria-current','page');else row.link.removeAttribute('aria-current')}
  mount(id)
}
async function refresh(){
  if(checking||closed)return;checking=true
  try{
    state=await send('connect')
    document.querySelector('#connection').textContent=({dsh:'DSH',pi:'Pi'}[state.harness]||'Harness')+' · '+({ready:'Verbunden','needs-setup':'Einrichtung nötig',connecting:'Verbinden…'}[state.phase]||state.phase||'Verbinden…')
    for(const row of sections.values())row.body.update?.()
    navigate()
  }catch(e){document.querySelector('#connection').textContent='Begleitprogramm nicht verfügbar';fail(e)}finally{checking=false}
}
watchAppearance();window.addEventListener('hashchange',navigate);navigate();void refresh()
const timer=setInterval(refresh,1500)
window.addEventListener('pagehide',()=>{closed=true;clearInterval(timer);for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close()},{once:true})
