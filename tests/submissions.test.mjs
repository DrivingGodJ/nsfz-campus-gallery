import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {getPlatformProxy} from 'wrangler';
import {handleSubmissions,cleanupSubmissions,validateAnnotation,MAX_PHOTO_BYTES} from '../worker/src/submissions.mjs';
import {readServiceResponse} from '../server/service-response.mjs';
import {serviceFailure} from '../worker/src/service-errors.mjs';
import {createReviewService} from '../server/submission-review.mjs';
import {createStore,exportStaticContent} from '../server/storage.mjs';
import {createSubmissionsClient,newSubmissionSession,photoAnnotation} from '../src/submissions-api.ts';
import {campusFilterLocations} from '../src/locations.ts';

const origin='https://campus.example';
async function fixture(){
  const proxy=await getPlatformProxy({configPath:new URL('../worker/wrangler.jsonc',import.meta.url).pathname,persist:false,remoteBindings:false});
  for(const name of ['0001_likes.sql','0002_submissions.sql']) for(const sql of (await fs.readFile(new URL('../worker/migrations/'+name,import.meta.url),'utf8')).split(';').map(s=>s.trim()).filter(Boolean))await proxy.env.DB.prepare(sql).run();
  const campus=JSON.parse(await fs.readFile(new URL('../worker/src/submission-campus.json',import.meta.url),'utf8'));
  const env={...proxy.env,ALLOWED_ORIGINS:origin,SUBMISSIONS_OWNER_TOKEN:'a'.repeat(64),SUBMISSIONS_LIMITER:{limit:async()=>({success:true})}};
  let now=Date.now(),verified=0;
  const deps={now:()=>now,verify:async token=>{verified++;return token==='valid';},sign:async row=>'https://uploads.example/'+row.object_key};
  const annotation={title:'校园',description:'',capturedAt:'2025-09-01T12:01:02',locationId:'',buildingId:'',captureType:'ground',floor:0,position:{x:0,z:0},heading:180,pitch:0,placed:true,author:'',copyright:'',view:{focalLength35Mm:35}};
  const input=()=>({...newSubmissionSession(),filename:'campus.jpg',size:10,contentType:'image/jpeg',annotation,turnstileToken:'valid'});
  const call=async(route,value,options={})=>{const admin=route.startsWith('admin/'),method=options.method || (value?'POST':'GET');return handleSubmissions(new Request('https://service.example/api/submissions/'+route,{method,headers:{'Content-Type':'application/json',...(admin?{Authorization:'Bearer '+env.SUBMISSIONS_OWNER_TOKEN}:{Origin:origin}),...options.headers},...(value?{body:JSON.stringify(value)}:{})}),env,campus,deps);};
  return {proxy,env,campus,annotation,input,call,deps,advance:ms=>now+=ms,now:()=>now,verified:()=>verified};
}

test('private original upload, stable retry, freeze before review, approval and cleanup',async()=>{
 const f=await fixture();try{
  const input=f.input();let response=await f.call('start',input);assert.equal(response.status,201);const started=await response.json();
  assert.equal((await f.call('start',input)).status,200);assert.equal(f.verified(),1,'existing upload resumes without reusing Turnstile');
  const budget=await f.env.DB.prepare('SELECT * FROM submission_budget').first();assert.equal(budget.reserved_bytes,10);assert.equal(budget.daily_count,1);
  assert.equal((await f.call('complete',input)).status,409);
  await f.env.UPLOADS.put('pending/'+input.id+'/source',new Uint8Array(10));
  assert.equal((await (await f.call('complete',input)).json()).status,'pending');
  assert.equal((await (await f.call('complete',input)).json()).status,'pending');
  assert.equal((await f.call('admin/'+input.id+'/file')).status,409,'presigned URL must expire before review download');
  assert.equal((await f.call('admin/'+input.id+'/decision',{status:'approved',photoId:crypto.randomUUID()})).status,409);
  assert.equal((await f.call('admin/list',undefined,{headers:{Origin:origin}})).status,403);
  assert.equal((await f.call('admin/list',undefined,{headers:{Authorization:'Bearer wrong'}})).status,403);
  f.advance(300001);const list=await (await f.call('admin/list')).json();assert.equal(list.submissions.length,1);assert.equal(list.submissions[0].ready,true);
  assert.equal((await f.call('admin/'+input.id+'/file')).status,200);
  const photoId=crypto.randomUUID();assert.equal((await f.call('admin/'+input.id+'/decision',{status:'approved',photoId})).status,200);
  assert.equal((await f.call('admin/'+input.id+'/decision',{status:'approved',photoId})).status,200,'decision retry is idempotent');
  assert.equal((await (await f.call('status',input)).json()).status,'approved');
  assert.equal((await f.call('admin/'+input.id+'/file')).status,409);
  await cleanupSubmissions(f.env,f.now());await cleanupSubmissions(f.env,f.now());
  assert.equal(await f.env.UPLOADS.head('pending/'+input.id+'/source'),null);assert.equal((await f.env.DB.prepare('SELECT * FROM submission_budget').first()).reserved_bytes,0);
  assert.ok(started.expiresAt);
 }finally{await f.proxy.dispose();}
});

test('concurrent quota reservations never exceed capacity; limits and UTC reset are explicit',async()=>{
 const f=await fixture();try{
  f.env.MAX_STORAGE_BYTES='30';f.env.MAX_DAILY_SUBMISSIONS='100';
  const results=await Promise.all(Array.from({length:8},()=>f.call('start',f.input())));
  assert.equal(results.filter(r=>r.status===201).length,3);assert.equal(results.filter(r=>r.status===429).length,5);
  assert.equal((await f.env.DB.prepare('SELECT * FROM submission_budget').first()).reserved_bytes,30);
  const limited=await (await f.call('start',f.input())).json();assert.equal(limited.code,'STORAGE_LIMIT');
  f.env.MAX_STORAGE_BYTES='100000';f.env.MAX_DAILY_SUBMISSIONS='3';
  assert.equal((await (await f.call('start',f.input())).json()).code,'DAILY_SUBMISSION_LIMIT');
  f.advance(86400000);assert.equal((await f.call('start',f.input())).status,201);
  const expired=await f.env.DB.prepare("SELECT id FROM submissions WHERE status='uploading' ORDER BY created_at LIMIT 1").first();
  await cleanupSubmissions(f.env,f.now());assert.equal((await f.env.DB.prepare('SELECT status FROM submissions WHERE id=?').bind(expired.id).first()).status,'expired');
 }finally{await f.proxy.dispose();}
});

test('source restrictions, exact sizes, receipt privacy and validation fail closed',async()=>{
 const f=await fixture();try{
  const input=f.input();assert.equal((await f.call('start',input,{headers:{Origin:'https://other.example'}})).status,403);
  assert.equal((await f.call('start',{...input,turnstileToken:'bad'})).status,403);
  assert.equal((await f.call('start',{...input,size:MAX_PHOTO_BYTES+1})).status,413);
  assert.equal((await f.call('start',{...input,annotation:{...f.annotation,locationId:'local/bell-tower'}})).status,400);
  assert.equal((await f.call('start',{...input,annotation:{...f.annotation,position:{x:Infinity,z:0}}})).status,400);
  assert.equal((await f.call('start',input)).status,201);
  assert.equal((await f.call('status',{...input,receipt:'b'.repeat(64)})).status,404);
  await f.env.UPLOADS.put('pending/'+input.id+'/source',new Uint8Array(9));assert.equal((await f.call('complete',input)).status,409);
  await f.env.UPLOADS.put('pending/'+input.id+'/source',new Uint8Array(10));await f.call('complete',input);await f.env.UPLOADS.put('pending/'+input.id+'/source',new Uint8Array(10).fill(9));
  f.advance(300001);assert.equal((await f.call('admin/'+input.id+'/file')).status,409,'changed ETag cannot sneak into reviewer import');
  const empty=await handleSubmissions(new Request('https://service.example/api/submissions/start',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(f.input())}),{...f.env,TURNSTILE_SECRET:undefined},f.campus,{now:f.deps.now,sign:f.deps.sign});
  assert.equal((await empty.json()).code,'NOT_CONFIGURED');
 }finally{await f.proxy.dispose();}
});

test('Turnstile validates server response action and hostname and fails closed on replay',async()=>{
 const f=await fixture(),original=globalThis.fetch;try{
  const env={...f.env,TURNSTILE_SECRET:'secret',TURNSTILE_HOSTNAMES:'campus.example'};
  const request=input=>new Request('https://service.example/api/submissions/start',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});
  for(const result of [{success:false},{success:true,hostname:'localhost',action:'photo-submit'},{success:true,hostname:'campus.example',action:'wrong'}]){
    globalThis.fetch=async(url,options)=>{assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');assert.equal(options.body.get('secret'),'secret');return Response.json(result);};
    assert.equal((await handleSubmissions(request(f.input()),env,f.campus,{sign:f.deps.sign})).status,403);
  }
  let used=false;globalThis.fetch=async()=>Response.json(used?{success:false}:(used=true,{success:true,hostname:'campus.example',action:'photo-submit'}));
  assert.equal((await handleSubmissions(request(f.input()),env,f.campus,{sign:f.deps.sign})).status,201);
  assert.equal((await handleSubmissions(request(f.input()),env,f.campus,{sign:f.deps.sign})).status,403);
 }finally{globalThis.fetch=original;await f.proxy.dispose();}
});

test('presigned PUT binds exact size/type and retries never extend original expiry',async()=>{
 const f=await fixture();try{
  const env={...f.env,R2_ACCOUNT_ID:'a'.repeat(32),R2_ACCESS_KEY_ID:'example-key',R2_SECRET_ACCESS_KEY:'example-secret'};
  const input=f.input(),make=()=>new Request('https://service.example/api/submissions/start',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});
  const first=await (await handleSubmissions(make(),env,f.campus,{now:f.deps.now,verify:f.deps.verify})).json();
  const url=new URL(first.uploadURL);assert.equal(url.searchParams.get('X-Amz-Expires'),'300');assert.match(url.searchParams.get('X-Amz-SignedHeaders'),/content-length/);assert.match(url.searchParams.get('X-Amz-SignedHeaders'),/content-type/);
  f.advance(60000);const second=await (await handleSubmissions(make(),env,f.campus,{now:f.deps.now,verify:f.deps.verify})).json();assert.equal(first.uploadURL,second.uploadURL);assert.equal(first.expiresAt,second.expiresAt);
 }finally{await f.proxy.dispose();}
});

test('review pagination includes records sharing an identical timestamp',async()=>{
 const f=await fixture();try{
  f.env.MAX_DAILY_SUBMISSIONS='200';for(let i=0;i<55;i++){const input=f.input();await f.call('start',input);await f.env.UPLOADS.put('pending/'+input.id+'/source',new Uint8Array(10));await f.call('complete',input);}
  const first=await (await f.call('admin/list')).json();assert.equal(first.submissions.length,50);assert.ok(first.nextBefore);
  const second=await (await f.call('admin/list?before='+encodeURIComponent(first.nextBefore))).json();assert.equal(second.submissions.length,5);assert.equal(new Set([...first.submissions,...second.submissions].map(p=>p.id)).size,55);
 }finally{await f.proxy.dispose();}
});

test('owner review retains drafts privately, publishes once, and recovers cloud acknowledgment failure',async()=>{
 const f=await fixture(),root=await fs.mkdtemp(path.join(os.tmpdir(),'nsfz-review-')),original=globalThis.fetch;try{
  await fs.mkdir(path.join(root,'public/data'),{recursive:true});await fs.copyFile(new URL('../public/data/campus.json',import.meta.url),path.join(root,'public/data/campus.json'));await fs.copyFile(new URL('../public/favicon.svg',import.meta.url),path.join(root,'public/favicon.svg'));
  const store=createStore(root),review=createReviewService(store,new URL('..',import.meta.url).pathname);
  await review.configure({mode:'cloud',url:'https://service.example',ownerToken:f.env.SUBMISSIONS_OWNER_TOKEN});
  const bytes=await sharp({create:{width:60,height:40,channels:3,background:'#557755'}}).jpeg().toBuffer(),input={...f.input(),size:bytes.length};await f.call('start',input);await f.env.UPLOADS.put('pending/'+input.id+'/source',bytes);await f.call('complete',input);f.advance(300001);
  let failDecision=true;globalThis.fetch=async req=>{if(req.url.endsWith('/decision') && failDecision)return Response.json({error:'模拟连接中断'},{status:503});return handleSubmissions(req,f.env,f.campus,f.deps);};
  const imported=await review.importSubmission(input.id);assert.equal((await store.state()).site.photos.length,0);assert.equal(imported.photo.title,'校园');assert.equal(imported.photo.author,'');
  assert.equal((await review.importSubmission(input.id)).photo.id,imported.photo.id);assert.equal((await store.state()).drafts.length,1);
  await assert.rejects(review.approve(input.id,imported.photo,0),/已经|已加入/);assert.equal((await store.state()).site.photos.length,1);
  failDecision=false;await review.approve(input.id,imported.photo,0);assert.equal((await store.state()).site.photos.length,1);
  await exportStaticContent(root,path.join(root,'dist'));const site=JSON.parse(await fs.readFile(path.join(root,'dist/data/site.json'),'utf8'));
  assert.equal(site.photos.length,1);assert.equal(site.photos[0].metadata.author,undefined);assert.equal(site.photos[0].id,imported.photo.id);
  await assert.rejects(fs.access(path.join(root,'dist/.local')));assert.ok((await review.imports())[0].synced);
  assert.equal(JSON.stringify(site).includes(f.env.SUBMISSIONS_OWNER_TOKEN),false);
 }finally{globalThis.fetch=original;await f.proxy.dispose();await fs.rm(root,{recursive:true,force:true});}
});

test('client reports platform quota HTML, D1 and R2 caps, and preserves actionable errors',async()=>{
 await assert.rejects(readServiceResponse(new Response('<html>Error 1027</html>',{status:429})),/08:00/);
 await assert.rejects(readServiceResponse(new Response('<html>Error 1102</html>',{status:500})),/超时/);
 await assert.rejects(readServiceResponse(new Response('unavailable',{status:503})),/已保留/);
 await assert.rejects(readServiceResponse(Response.json({error:'空间已满',code:'STORAGE_LIMIT'},{status:429})),/空间已满/);
 assert.equal(serviceFailure(new Error('D1_ERROR: daily read quota exceeded')).code,'DATABASE_LIMIT');
 assert.equal(serviceFailure(new Error('network issue')).code,'SERVICE_UNAVAILABLE');
 const p={position:{x:1,z:2,height:999},metadata:{author:'private-source'},files:{display:'secret'},title:'x',description:'',capturedAt:'',floor:0,captureType:'ground',heading:0,pitch:0,placed:true};
 assert.equal(photoAnnotation(p).metadata,undefined);assert.equal(photoAnnotation(p).files,undefined);assert.equal(photoAnnotation(p).position.height,undefined);
 const client=createSubmissionsClient('https://service.example',async()=>new Response('<html>1027</html>',{status:429}));await assert.rejects(client.config(),/请求额度/);
});

test('submission destination manifest exactly matches upload/filter major places and corridors',async()=>{
 const campus=JSON.parse(await fs.readFile(new URL('../public/data/campus.json',import.meta.url),'utf8')),manifest=JSON.parse(await fs.readFile(new URL('../worker/src/submission-campus.json',import.meta.url),'utf8'));
 assert.deepEqual(new Set(manifest.locationIds),new Set(campusFilterLocations(campus,{buildingOverrides:{}}).map(l=>l.id)));
 assert.throws(()=>validateAnnotation({title:'x',placed:true,captureType:'aerial',floor:0,position:{x:0,z:0},heading:0,pitch:0,capturedAt:'',locationId:''},manifest),/航拍高度/);
});
