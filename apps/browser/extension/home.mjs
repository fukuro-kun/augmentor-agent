// Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
export function homeSettings(document,send,parent){
 const make=(tag,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
 const form=make('form'),status=make('p');status.setAttribute('role','status');const fields={};
 form.append(make('p','Kopple diesen Augmentor einmal mit deinem NAS, dann kannst du Home-Aufgaben in deinen bestehenden Unterhaltungen anfordern.'));
 for(const [name,label,value] of [['url','Home-HTTPS-URL',''],['name','Gerätename','Augmentor browser'],['code','Einmal-Pairing-Code','']]){const l=make('label',label),input=make('input');input.name=name;input.value=value;input.required=true;input.type=name==='code'?'password':'text';l.append(input);form.append(l);fields[name]=input;}
 const connect=make('button','Verbinden');connect.type='submit';const disconnect=make('button','Trennen');disconnect.type='button';form.append(connect,disconnect,status);parent.append(form);
 async function run(action,params={}){connect.disabled=true;disconnect.disabled=true;try{const r=await send('homeConnection',{request:{action,...params}});if(!r?.ok)throw Error(r?.error??'Home-Verbindung nicht verfügbar');status.textContent=r.connected?'Verbunden. Frage Augmentor zu deinem Zuhause.':'Nicht verbunden.';connect.disabled=!!r.connected;disconnect.disabled=!r.connected;if(r.url)fields.url.value=r.url;}catch(e){status.textContent=e.message;connect.disabled=false;disconnect.disabled=false;}}
 form.onsubmit=e=>{e.preventDefault();const values=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.value.trim()]));fields.code.value='';void run('pair',values);};disconnect.onclick=()=>run('disconnect');void run('state');
}
