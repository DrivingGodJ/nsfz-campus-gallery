import fs from 'node:fs/promises';
import path from 'node:path';
import { submissionPlatform } from './submission-platform.mjs';
import { ID_PATTERN, MAX_UPLOAD, UserError, writeJSON, validatePhoto } from './storage.mjs';
import { readServiceResponse } from './service-response.mjs';

export function createReviewService(store,root) {
  const settingsFile=path.join(store.localRoot,'submission-service.json'),journalFile=path.join(store.localRoot,'submission-reviews.json');
  let chain=Promise.resolve();
  const serial=fn=>{const result=chain.then(fn);chain=result.catch(()=>{});return result;};
  const read=async(file,fallback)=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
  async function config() {
    const settings=await read(settingsFile,null);
    return {mode:settings?'cloud':'local',url:settings?.url || '',configured:!!settings};
  }
  async function configure(input) {
    if(input.mode==='local'){await fs.rm(settingsFile,{force:true});return config();}
    const url=new URL(input.url);
    if(url.protocol!=='https:' || url.pathname!=='/' || url.search || url.hash || url.username || url.password) throw new UserError('请填写服务的 HTTPS 来源地址，不带路径。');
    if(typeof input.ownerToken!=='string' || input.ownerToken.length<32 || input.ownerToken.length>256) throw new UserError('审核密钥至少需要 32 个字符。');
    await fs.mkdir(store.localRoot,{recursive:true});await writeJSON(settingsFile,{url:url.origin,ownerToken:input.ownerToken});await fs.chmod(settingsFile,0o600);
    return config();
  }
  async function request(route,method='GET',body) {
    const settings=await read(settingsFile,null);
    const base=settings?.url || 'http://local-review';
    const local=!settings ? await submissionPlatform(root) : null;
    const req=new Request(base+'/api/submissions/admin/'+route,{method,headers:{Authorization:'Bearer '+(settings?.ownerToken || local.env.SUBMISSIONS_OWNER_TOKEN),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const response=local ? await local.handle(req) : await fetch(req,{signal:AbortSignal.timeout(30000)});
    if(route.endsWith('/file') && response.ok)return response;
    return readServiceResponse(response);
  }
  async function list(before='') {
    const remote=await request('list'+(before?'?before='+encodeURIComponent(before):''));
    const journal=await read(journalFile,{});
    return {...remote,submissions:remote.submissions.map(row=>({...row,localPhotoId:journal[row.id]?.photoId || '',needsSync:!!journal[row.id]?.published})),config:await config()};
  }
  async function importSubmission(id) {return serial(async()=>{
    if(!ID_PATTERN.test(id))throw new UserError('投稿编号无效。');
    const journal=await read(journalFile,{}),state=await store.state();
    if(journal[id]?.photoId){const photo=[...state.drafts,...state.site.photos].find(p=>p.id===journal[id].photoId);if(photo)return {photo};throw new UserError('审核草稿已移除，请恢复后再审核。',409);}
    // Backend holds private originals, and refuses download until all presigned URLs expire.
    const record=await request(id+'/record');
    const response=await request(id+'/file');
    const reader=response.body.getReader();let size=0;const chunks=[];
    try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_UPLOAD){await reader.cancel();throw new UserError('原片超过 40 MB。',413);}chunks.push(value);}}finally{reader.releaseLock();}
    if(size!==record.size)throw new UserError('原片下载不完整，请重试。');
    const draft=await store.importPhoto(Buffer.concat(chunks.map(b=>Buffer.from(b))));
    journal[id]={photoId:draft.id,filename:record.filename,importedAt:new Date().toISOString(),published:false};
    await writeJSON(journalFile,journal);
    try {const photo=await store.updateDraft(draft.id,{...draft,...record.annotation,id:draft.id});return {photo};}
    catch(e){throw new UserError('原片已导入，但投稿标注未通过校验。请在内容库修正草稿，再通过审核。'+e.message);}
  });}
  async function approve(id,photo,revision) {return serial(async()=>{
    const journal=await read(journalFile,{}),entry=journal[id];
    if(!ID_PATTERN.test(id) || !entry || entry.photoId!==photo?.id)throw new UserError('请先导入这份投稿，再审核。');
    const remote=await request(id+'/record');
    if(remote.status!=='pending' && !(remote.status==='approved' && remote.photoId===entry.photoId)) throw new UserError('该投稿已退回或过期，请刷新列表。',409);
    const state=await store.state();
    let saved=state.site.photos.find(p=>p.id===entry.photoId);
    if(!saved){await store.updateDraft(entry.photoId,photo);saved=await store.publish(entry.photoId,revision);}
    else if(JSON.stringify(validatePhoto(photo,saved,state.map))!==JSON.stringify(saved)) saved=await store.updatePhoto(entry.photoId,photo,revision);
    entry.published=true;await writeJSON(journalFile,journal);
    try{await request(id+'/decision','POST',{status:'approved',photoId:entry.photoId});entry.synced=true;await writeJSON(journalFile,journal);}
    catch(e){throw new UserError('照片已加入本地内容库，但云端审核状态尚未同步。请再次点击“通过审核”完成同步，不会重复入库。'+e.message,503);}
    return {photo:saved};
  });}
  async function reject(id,reason) {return serial(async()=>{
    if(!ID_PATTERN.test(id))throw new UserError('投稿编号无效。');
    const journal=await read(journalFile,{});
    if(journal[id]?.published)throw new UserError('这份投稿已经入库，请先同步通过审核的状态。',409);
    await request(id+'/decision','POST',{status:'rejected',reason});
    if(journal[id]){journal[id].rejected=true;await writeJSON(journalFile,journal);}
    // Imported drafts remain recoverable; public content is never automatically removed.
    return {ok:true};
  });}
  const imports=async()=>Object.entries(await read(journalFile,{})).map(([id,value])=>({id,...value}));
  return {config,configure,list,importSubmission,approve,reject,imports};
}
