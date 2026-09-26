// Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
// Delegated desktop vision: screenshots persist in a bounded per-user store so
// a text-only main model can route a focused question through the LAN
// InferenzQuelle VLM. The image never enters the chat history; each capture
// and query leaves a JSON sidecar so queries stay auditable after the fact.
import {randomBytes} from 'node:crypto';
import {mkdirSync,readdirSync,readFileSync,statSync,unlinkSync,writeFileSync,type Stats} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const CAP_BYTES=50*1024*1024;
const MIN_KEEP_MS=60000;
const latest=new Map<string,string>();
const vision={endpoint:'http://127.0.0.1:8012',model:'gemma-4',timeoutMs:180000};

export function configureVision(options:{endpoint?:string,model?:string,timeoutMs?:number}){
 if(options.endpoint)vision.endpoint=options.endpoint.replace(/\/$/,'');
 if(options.model)vision.model=options.model;
 if(typeof options.timeoutMs==='number'&&options.timeoutMs>=1000)vision.timeoutMs=options.timeoutMs;
}

export function observationRoot(env:NodeJS.ProcessEnv=process.env){
 return env.AUGMENTOR_OBSERVATION_DIR??join(env.XDG_STATE_HOME??join(homedir(),'.local','state'),'augmentor','desktop-observations');
}

function sidecarPath(path:string){return path.replace(/\.[a-z]+$/,'.json')}

export function prune(root:string,capBytes=CAP_BYTES,now:number=Date.now()){
 let names:string[];
 try{names=readdirSync(root)}catch{return}
 const files:{name:string,stat:Stats}[]=[];
 for(const name of names){
  if(!/^obs-[^/]+\.(png|jpe?g|webp|json)$/.test(name))continue;
  try{files.push({name,stat:statSync(join(root,name))})}catch{}
 }
 let total=files.reduce((sum,file)=>sum+file.stat.size,0);
 for(const file of files.sort((a,b)=>a.stat.mtimeMs-b.stat.mtimeMs)){
  if(total<=capBytes)break;
  // Fresh files can sit under an in-flight vision query; never pull those.
  if(now-file.stat.mtimeMs<MIN_KEEP_MS)continue;
  try{unlinkSync(join(root,file.name));total-=file.stat.size}catch{}
  // Remove the sibling of an observation pair too — a lone sidecar or a
  // screenshot without its query log leaves a misleading audit trail.
  const stem=file.name.replace(/\.[a-z]+$/,'');
  const siblings=file.name.endsWith('.json')?['.png','.jpg','.jpeg','.webp'].map(ext=>stem+ext):[stem+'.json'];
  for(const sibling of siblings){
   // The pair travels together, but a sibling still fresh enough for an
   // in-flight query is left alone (sidecars are rewritten per query).
   try{const stat=statSync(join(root,sibling));
    if(now-stat.mtimeMs>=MIN_KEEP_MS){unlinkSync(join(root,sibling));total-=stat.size}
   }catch{}
  }
 }
}

export function recordObservation(owner:string,image:{data:string,mimeType:string},{root=observationRoot(),at=new Date()}={}){
 mkdirSync(root,{recursive:true,mode:0o700});
 const ext=image.mimeType==='image/jpeg'?'jpg':image.mimeType==='image/webp'?'webp':'png';
 const capturedAt=at.toISOString();
 const name=`obs-${capturedAt.replace(/[:.]/g,'-')}-${randomBytes(3).toString('hex')}.${ext}`;
 const data=Buffer.from(image.data,'base64');
 const path=join(root,name);
 writeFileSync(path,data,{mode:0o600});
 writeFileSync(sidecarPath(path),JSON.stringify({owner,capturedAt,bytes:data.length,mimeType:image.mimeType,queries:[]}),{mode:0o600});
 latest.set(owner,path);
 // Bound the owner→path index; dead owners are also evicted lazily by
 // latestObservation's existence check.
 if(latest.size>256)latest.delete(latest.keys().next().value!);
 prune(root);
 return {path,bytes:data.length,capturedAt};
}

export function latestObservation(owner:string){
 const path=latest.get(owner);
 if(!path)return;
 try{statSync(path);return path}catch{latest.delete(owner)}
}

export async function visionQuery({question,path,signal,endpoint,model,timeoutMs}:{question:string,path:string,signal?:AbortSignal,endpoint?:string,model?:string,timeoutMs?:number}){
 const base=(endpoint??vision.endpoint).replace(/\/$/,'');
 const useModel=model??vision.model;
 let image:Buffer;
 try{image=readFileSync(path)}catch{throw Error('Die gespeicherte Desktop-Beobachtung fehlt — erfasse den Desktop erneut.')}
 const mime=path.endsWith('.jpg')||path.endsWith('.jpeg')?'image/jpeg':path.endsWith('.webp')?'image/webp':'image/png';
 const signals=[AbortSignal.timeout(timeoutMs??vision.timeoutMs)];if(signal)signals.push(signal);
 let response;
 try{
  response=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},
   signal:AbortSignal.any(signals),
   body:JSON.stringify({model:useModel,max_tokens:1500,messages:[
    {role:'system',content:'You are a visual analysis sensor for a Linux desktop-control agent. Answer the question about the screenshot concisely and concretely. Give pixel coordinates relative to the screenshot image when asked for positions. If something is not visible, say so honestly. Do not add general advice beyond the question.'},
    {role:'user',content:[{type:'image_url',image_url:{url:`data:${mime};base64,${image.toString('base64')}`}},{type:'text',text:question}]}]})});
 }catch(error){
  if((error as Error)?.name==='TimeoutError'||(error as Error)?.name==='AbortError'){
   if(signal?.aborted)throw signal.reason??error;
   throw Error('Der Vision-Endpunkt hat die Anfrage nicht rechtzeitig beantwortet — er startet das Bildmodell möglicherweise noch.');
  }
  throw Error('Der Vision-Endpunkt ist nicht erreichbar.');
 }
 const result=await response.json().catch(()=>null);
 if(!response.ok)throw Error(`Der Vision-Endpunkt meldet HTTP ${response.status}${result?.error?.message?': '+result.error.message:'.'}`);
 const content=result?.choices?.[0]?.message?.content;
 const text=typeof content==='string'?content.trim():'';
 // Thinking models can spend the whole budget on reasoning_content — surface
 // that case so callers know to raise max_tokens rather than seeing a bare
 // empty-answer failure.
 const finish=result?.choices?.[0]?.finish_reason??'unbekannt';
 if(!text)throw Error(finish==='length'?`Das Bildmodell verbrauchte das Token-Budget im Denken ohne Antwort (finish_reason: length).`:`Das Bildmodell gab keine Antwort (finish_reason: ${finish}).`);
 let capturedAt:string|undefined;
 try{
  const metaPath=sidecarPath(path);
  const meta=JSON.parse(readFileSync(metaPath,'utf8'));
  capturedAt=meta.capturedAt;
  meta.queries=[...(meta.queries??[]),{askedAt:new Date().toISOString(),question,model:result?.model??useModel,answer:text.slice(0,2000)}];
  writeFileSync(metaPath,JSON.stringify(meta),{mode:0o600});
 }catch{}
 return {text,model:result?.model??useModel,observation:{path,...(capturedAt?{capturedAt}:{})}};
}
