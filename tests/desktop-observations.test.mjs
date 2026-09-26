// Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,readdirSync,statSync,unlinkSync,utimesSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {latestObservation,prune,recordObservation,visionQuery} from '../dist/desktop/src/observations.js'

const png=Buffer.alloc(2048,7).toString('base64')
const dir=()=>mkdtempSync(join(tmpdir(),'augmentor-obs-'))

test('recordObservation persists image and sidecar with unique timestamp names',t=>{
 const root=dir()
 const a=recordObservation('dsh:a',{data:png,mimeType:'image/png'},{root})
 const b=recordObservation('dsh:a',{data:png,mimeType:'image/png'},{root})
 assert.notEqual(a.path,b.path)
 assert.match(a.path,/obs-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{6}\.png$/)
 assert.ok(statSync(a.path).size===2048)
 const meta=JSON.parse(readFileSync(a.path.replace(/\.png$/,'.json'),'utf8'))
 assert.equal(meta.owner,'dsh:a');assert.equal(meta.bytes,2048);assert.deepEqual(meta.queries,[])
 assert.equal(latestObservation('dsh:a'),b.path)
 assert.equal(latestObservation('dsh:other'),undefined)
})
test('prune removes oldest observations over the cap but keeps fresh files',t=>{
 const root=dir()
 const old=join(root,'obs-2000-01-01T00-00-00-000Z-aaaaaa.png')
 writeFileSync(old,Buffer.alloc(4000));writeFileSync(old.replace('.png','.json'),'{}')
 const now=Date.now()
 utimesSync(old,0,0);utimesSync(old.replace('.png','.json'),0,0)
 const fresh=join(root,'obs-2222-01-01T00-00-00-000Z-bbbbbb.png')
 writeFileSync(fresh,Buffer.alloc(4000))
 assert.ok(statSync(fresh).size===4000)
 prune(root,5000,now)
 assert.deepEqual(readdirSync(root).sort(),['obs-2222-01-01T00-00-00-000Z-bbbbbb.png'])
})
test('prune protects files younger than a minute even over the cap',t=>{
 const root=dir();const now=Date.now()
 writeFileSync(join(root,'obs-2222-01-01T00-00-00-000Z-aaaaaa.png'),Buffer.alloc(6000))
 prune(root,1000,now)
 assert.equal(readdirSync(root).length,1)
})
test('visionQuery posts the stored screenshot with the focused question',async t=>{
 const root=dir()
 const {path}=recordObservation('dsh:v',{data:png,mimeType:'image/png'},{root})
 let seen
 const original=globalThis.fetch
 globalThis.fetch=async(url,init)=>{seen={url,init};return{ok:true,json:async()=>({choices:[{message:{content:'Der Button liegt bei (120, 40).'}}],model:'glm-4.6v-flash'})}}
 t.after(()=>{globalThis.fetch=original})
 const answer=await visionQuery({question:'Wo ist der Speichern-Button?',path})
 assert.equal(answer.text,'Der Button liegt bei (120, 40).')
 assert.equal(answer.model,'glm-4.6v-flash')
 assert.ok(seen.url.endsWith('/v1/chat/completions'))
 const body=JSON.parse(seen.init.body)
 const content=body.messages[1].content
 assert.equal(content[0].type,'image_url');assert.ok(content[0].image_url.url.startsWith('data:image/png;base64,'))
 assert.equal(content[1].text,'Wo ist der Speichern-Button?')
 assert.equal(body.messages[0].role,'system')
 const meta=JSON.parse(readFileSync(path.replace(/\.png$/,'.json'),'utf8'))
 assert.equal(meta.queries.length,1);assert.equal(meta.queries[0].question,'Wo ist der Speichern-Button?')
 assert.equal(meta.queries[0].answer,'Der Button liegt bei (120, 40).')
})
test('visionQuery fails honestly on a missing or rejected observation',async t=>{
 const root=dir()
 const original=globalThis.fetch
 globalThis.fetch=async()=>({ok:false,status:503,json:async()=>({error:{message:'vlm unavailable'}})})
 t.after(()=>{globalThis.fetch=original})
 await assert.rejects(visionQuery({question:'x',path:join(root,'obs-missing.png')}),/fehlt/)
 const {path}=recordObservation('dsh:v',{data:png,mimeType:'image/png'},{root})
 await assert.rejects(visionQuery({question:'x',path}),/HTTP 503.*vlm unavailable/)
})
