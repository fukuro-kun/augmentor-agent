// Augmentor — dsh-augmentor plugin, pipe, and Chromium extension
// Copyright © 2026 Manolo Remiddi
// SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
// License: MIT with Augmentor Resale Restriction — see LICENSE at the repository root.
import {presentSettingsForm} from './settings-form.mjs'
export function memoryDialog(doc,send,provenance,container){
  const dialog=doc.createElement('dialog');dialog.className='shared-prompt-editor memory-dialog'
  const make=(tag,text)=>{const e=doc.createElement(tag);if(text)e.textContent=text;return e}
  const intro=make('p','Beziehungs- und Arbeitsgedächtnis entsteht automatisch aus Unterhaltungen. Hindsight pflegt Beziehungsseiten und ein durchsuchbares Projektgedächtnis.')
  const automatic=make('fieldset'),autoNote=make('p','Automatisches Gedächtnis wird geladen…'),autoContext=make('pre');autoContext.style.whiteSpace='pre-wrap';automatic.append(make('legend','Automatische Kontinuität'),make('p','Transkripte werden lokal gespeichert. Hindsight verarbeitet Beziehungs- und Projektkontext automatisch, mit dauerhaftem Wiederholen. Die Sprachfunktion bringt Beziehungskontinuität in die Unterhaltung.'),autoNote,autoContext)
  const connection=make('fieldset'),legend=make('legend','Optionale manuelle Bibliotheksverbindung'),fields={};connection.append(legend)
  for(const [id,label,placeholder] of [['endpoint','Endpunkt','http://127.0.0.1:8888'],['apiKey','API-Schlüssel','Für einen entfernten Dienst erforderlich'],['userBank','Nutzerbank',''],['projectBank','Projektbank (optional)','']]){
    const l=make('label',label),e=make('input');e.setAttribute('aria-label',label);e.placeholder=placeholder;e.type=id==='apiKey'?'password':'text';l.append(e);connection.append(l);fields[id]=e
  }
  const scope=make('select');scope.setAttribute('aria-label','Abrufbereich des Agenten')
  const dataScope=make('select');dataScope.setAttribute('aria-label','Datenbereich des Gedächtnisses')
  for(const select of [scope,dataScope])for(const id of ['user','project']){const option=make('option',id==='user'?'Nutzer':'Projekt');option.value=id;select.append(option)}
  const scopeLabel=make('label','Abrufbereich des Agenten');scopeLabel.append(scope);connection.append(scopeLabel)
  connection.append(make('p','Erfordert Hindsight 0.9.2. Die Prüfung sendet keinen Chatverlauf. Speichern aktiviert den Abruf. „Merken" sendet nur den unten eingegebenen Text; Hindsight kann für die Verarbeitung Kosten berechnen. Der Schlüssel wird privat und unverschlüsselt gespeichert.'))
  const connectionActions=make('div'),data=make('fieldset');connection.append(connectionActions);data.append(make('legend','Erinnerungen'),dataScope)
  const text=make('textarea');text.rows=3;text.setAttribute('aria-label','Erinnerungstext');text.placeholder='Zu merkender Text. Nur dieser Text wird gespeichert.';data.append(text)
  const dataActions=make('div'),operationNote=make('p'),list=make('select'),contents=make('textarea'),pageNote=make('p');list.size=4;list.setAttribute('aria-label','Gespeicherte Dokumente');contents.rows=4;contents.readOnly=true;contents.setAttribute('aria-label','Text des gespeicherten Dokuments')
  data.append(dataActions,operationNote,list,contents,pageNote)
  const note=make('p','Gedächtniseinstellungen werden geladen…'),actions=make('div')
  dialog.append(make('h3','Gedächtnis'),intro,automatic,connection,data,note,actions);doc.body.append(dialog)
  let config={},token=null,busy=false,closed=false,rows=[],offset=0,total=0
  const button=(parent,label,fn)=>{const b=make('button',label);b.type='button';b.onclick=fn;parent.append(b);return b}
  const request=async(action,params={})=>{const r=await send('memory',{request:{action,...params}});if(!r.ok)throw Error(r.error);return r.result}
  let autoEnabled=true
  const loadAutomatic=async()=>{
    const value=await request('dual.describe');autoEnabled=!!value.enabled;autoToggle.textContent=autoEnabled?'Automatisches Gedächtnis pausieren':'Automatisches Gedächtnis fortsetzen';autoNote.textContent=(autoEnabled?'Automatisches Gedächtnis ist an. ':'Automatisches Gedächtnis ist pausiert. ')+`${value.events} Transkripteinträge; ${value.pending} Gedächtnisbereiche ausstehend. ${value.message||''}`
    const source=provenance();if(source.sessionId){try{const context=await request('dual.recall',{session:source.harness+':'+source.sessionId});autoContext.textContent=[['relationship','Beziehung'],['work','Arbeit']].map(([kind,label])=>label+': '+(context[kind]?.summary||'Noch kein verdichtetes Bild.')).join('\n\n')}catch{autoContext.textContent='Gemerkter Kontext erscheint, nachdem diese Unterhaltung das automatische Gedächtnis genutzt hat.'}}
  }
  const autoToggle=button(automatic,'Automatisches Gedächtnis pausieren',async()=>{autoToggle.disabled=true;try{await request('dual.configure',{enabled:!autoEnabled});await loadAutomatic()}catch(e){autoNote.textContent=e.message}finally{autoToggle.disabled=false}})
  button(automatic,'Gemerkten Kontext aktualisieren',()=>{void loadAutomatic().catch(e=>autoNote.textContent=e.message)})
  void loadAutomatic().catch(()=>{autoNote.textContent='Das automatische Gedächtnis erfordert das aktualisierte Augmentor-Begleitprogramm.'})
  const controls=()=>{connection.disabled=busy;data.disabled=busy;save.disabled=busy||!token;retain.disabled=busy||!config.enabled}
  const run=async(fn)=>{if(busy)return;busy=true;controls();try{await fn()}catch(e){note.textContent=e.message}finally{busy=false;controls()}}
  const invalidate=()=>{token=null;controls()};for(const e of [...Object.values(fields),scope])e.addEventListener('input',invalidate)
  const loadConfig=async()=>{
    config=await request('describe');token=null
    for(const id of ['endpoint','projectBank'])fields[id].value=config[id]??''
    fields.userBank.value=config.userBank??'augmentor-user-'+crypto.randomUUID().slice(0,12)
    fields.apiKey.value='';fields.apiKey.placeholder=config.apiKeySet?'Gespeicherter Schlüssel bleibt, wenn leer':'Für einen entfernten Dienst erforderlich'
    scope.value=config.activeScope??'user';dataScope.value=scope.value
    note.textContent=config.enabled?'Hindsight-Gedächtnis aktiviert.':'Hindsight-Gedächtnis deaktiviert.'
  }
  const operations=async()=>{
    const value=await request('operations',{scope:dataScope.value})
    const pending=value.items.find(r=>!['completed','failed','cancelled','deleted'].includes(r.status))
    if(pending){const result=await request('operation',{scope:dataScope.value,id:pending.id});Object.assign(pending,result)}
    operationNote.textContent=value.items.slice(0,4).map(r=>r.document.slice(-12)+': '+r.status).join('\n')
  }
  const refresh=async()=>{
    if(!config.endpoint)return
    const value=await request('documents',{scope:dataScope.value,offset});rows=value.items;total=value.total;list.replaceChildren();contents.value=''
    for(const row of rows){const option=make('option',row.id+' · '+row.memory_unit_count+' Fakten');option.value=row.id;list.append(option)}
    list.selectedIndex=-1;pageNote.textContent=`${rows.length?offset+1:0}–${offset+rows.length} von ${total} Dokumenten.`;await operations()
  }
  button(connectionActions,'Verbindung prüfen',()=>run(async()=>{token=null;const result=await request('check',{...Object.fromEntries(Object.entries(fields).map(([k,e])=>[k,e.value])),activeScope:scope.value});token=result.token;note.textContent='Verbindung geprüft. Speichern, um das Gedächtnis zu aktivieren.'}))
  const save=button(connectionActions,'Speichern und aktivieren',()=>run(async()=>{await request('configure',{token});await loadConfig();offset=0;await refresh()}))
  button(connectionActions,'Gedächtnis deaktivieren',()=>run(async()=>{await request('disable');await loadConfig()}))
  connection.append(make('p','Deaktivieren stoppt neue Abrufe und Speicherungen. Übermittelte Vorgänge können noch fertig werden. Gespeicherte Daten bleiben für Ansicht, Export und Löschung verfügbar.'))
  const retain=button(dataActions,'Diesen Text merken',()=>run(async()=>{
    if(!text.value.trim())throw Error('Gib den zu merkenden Text ein.')
    const value=await request('retain',{scope:dataScope.value,content:text.value,provenance:provenance(),requestId:crypto.randomUUID()})
    text.value='';note.textContent=value.status==='pending'?'Speicherung eingereiht. Aktualisieren, um den Abschluss zu prüfen.':'Das Ergebnis der Speicherung ist unbekannt. Prüfe den Status vor einem erneuten Speichern.';await operations()
  }))
  button(dataActions,'Aktualisieren',()=>run(refresh))
  button(dataActions,'Zurück',()=>run(async()=>{offset=Math.max(0,offset-20);await refresh()}))
  button(dataActions,'Weiter',()=>run(async()=>{if(offset+rows.length<total){offset+=20;await refresh()}}))
  list.onchange=()=>run(async()=>{const value=await request('document',{scope:dataScope.value,id:list.value});contents.value=value.original_text??'(Kein Quelltext)'})
  dataScope.onchange=()=>run(async()=>{offset=0;await refresh()})
  button(dataActions,'Auswahl löschen',()=>run(async()=>{
    if(!list.value)return
    if(!doc.defaultView.confirm('Dieses Quelldokument und die zugehörigen Erinnerungen aus Hindsight löschen?'))return
    await request('delete',{scope:dataScope.value,id:list.value});await refresh();note.textContent='Gedächtnisdokument gelöscht.'
  }))
  button(dataActions,'Fakten exportieren',()=>run(async()=>{
    const facts=[];let next=0
    while(true){const page=await request('exportPage',{scope:dataScope.value,offset:next});facts.push(...page.items);next+=page.items.length;if(next>=page.total)break;if(!page.items.length)throw Error('Das Gedächtnis hat sich während des Exports geändert. Bitte erneut versuchen.')}
    const url=URL.createObjectURL(new Blob([JSON.stringify({provider:'hindsight',scope:dataScope.value,facts},null,2)],{type:'application/json'}));const a=make('a');a.href=url;a.download='augmentor-memory.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);note.textContent='Gedächtnisfakten exportiert.'
  }))
  button(actions,'Fertig',()=>dialog.close())
  dialog.addEventListener('close',()=>{closed=true;fields.apiKey.value='';dialog.remove()})
  dialog.addEventListener('cancel',()=>{if(busy)note.textContent='Übermittelte Vorgänge bleiben unter Gedächtnis verfügbar.'})
  presentSettingsForm(dialog,container);void run(async()=>{await loadConfig();if(!closed)await refresh()});return dialog
}
