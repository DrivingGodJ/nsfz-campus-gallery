import { timingSafeEqual } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import { validCaptureTime } from '../../server/capture-time.mjs';
import { serviceFailure } from './service-errors.mjs';

export const MAX_PHOTO_BYTES = 40 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MIMES = new Set(['image/jpeg','image/png','image/webp','image/avif','image/tiff','image/heic','image/heif']);
export class SubmissionError extends Error {
  /** @param {string} message @param {number} [status] @param {string} [code] */
  constructor(message, status = 400, code = 'INVALID_SUBMISSION') { super(message); this.status = status; this.code = code; }
}
/** @param {unknown} value @param {number} max @param {string} label */
function text(value, max, label) {
  if (typeof value !== 'string' || value.length > max) throw new SubmissionError(label + '格式不正确。');
  return value.trim();
}
/** @param {unknown} input @param {{locationIds:string[],buildingIds:string[],bounds:number[]}} campus */
export function validateAnnotation(input, campus) {
  if (!input || typeof input !== 'object') throw new SubmissionError('请填写照片资料。');
  const p = /** @type {Record<string, any>} */ (input);
  const title = text(p.title, 160, '标题');
  if (!title || p.placed !== true) throw new SubmissionError('请填写标题并标记拍摄位置。');
  const locationId = text(p.locationId ?? p.buildingId ?? '', 80, '地点');
  if (locationId && !campus.locationIds.includes(locationId)) throw new SubmissionError('请选择主要建筑、校园区域或通道。');
  const buildingId = campus.buildingIds.includes(locationId) ? locationId : '';
  const captureType = p.captureType;
  if (!['ground','aerial'].includes(captureType)) throw new SubmissionError('拍摄方式无效。');
  if (!Number.isInteger(p.floor) || (captureType === 'ground' && buildingId ? p.floor < 1 || p.floor > 50 : p.floor !== 0)) throw new SubmissionError('楼层无效。');
  if (p.cameraHeight !== undefined && (!Number.isFinite(p.cameraHeight) || p.cameraHeight < .1 || p.cameraHeight > 11.9)) throw new SubmissionError('拍摄高度需在 0.1 到 11.9 米之间。');
  const x = p.position?.x, z = p.position?.z;
  const [xmin,xmax,zmin,zmax] = campus.bounds;
  if (!Number.isFinite(x) || !Number.isFinite(z) || x < xmin || x > xmax || z < zmin || z > zmax) throw new SubmissionError('拍摄位置超出校园范围。');
  if (!Number.isFinite(p.heading) || p.heading < 0 || p.heading > 360 || !Number.isFinite(p.pitch) || Math.abs(p.pitch) > 90) throw new SubmissionError('镜头方向无效。');
  const capturedAt = text(p.capturedAt || '', 30, '拍摄时间');
  if (!validCaptureTime(capturedAt)) throw new SubmissionError('拍摄时间无效。');
  let altitude;
  if (captureType === 'aerial') {
    if (!Number.isFinite(p.altitude?.meters) || p.altitude.meters < -12000 || p.altitude.meters > 100000 || !['takeoff','seaLevel'].includes(p.altitude.reference)) throw new SubmissionError('请补充航拍高度。');
    altitude = { meters: p.altitude.meters, reference: p.altitude.reference };
  }
  /** @type {{focalLength35Mm?:number,cropFactor?:number}} */
  const view = {};
  if (p.view?.focalLength35Mm !== undefined) {
    if (!Number.isFinite(p.view.focalLength35Mm) || p.view.focalLength35Mm < 1 || p.view.focalLength35Mm > 10000) throw new SubmissionError('焦距无效。');
    view.focalLength35Mm = p.view.focalLength35Mm;
  }
  if (p.view?.cropFactor !== undefined) {
    if (!Number.isFinite(p.view.cropFactor) || p.view.cropFactor < .5 || p.view.cropFactor > 5) throw new SubmissionError('画幅无效。');
    view.cropFactor = p.view.cropFactor;
  }
  return { title, description: text(p.description || '', 10000, '描述'), capturedAt, locationId, buildingId, floor: p.floor,
    captureType, ...(altitude ? { altitude } : {}), ...(p.cameraHeight !== undefined ? { cameraHeight: p.cameraHeight } : {}), position: { x, z }, heading: p.heading % 360, pitch: p.pitch, placed: true,
    author: text(p.author || '', 200, '作者'), copyright: text(p.copyright || '', 3000, '版权'), view };
}
/** @param {string} value */
export async function hashReceipt(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2,'0')).join('');
}
/** @param {string} a @param {string} b */
async function safeEqual(a, b) { return timingSafeEqual(new TextEncoder().encode(await hashReceipt(a)),new TextEncoder().encode(await hashReceipt(b))); }
/** @param {Request} request */
async function readJSON(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') throw new SubmissionError('请求内容格式不正确。', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new SubmissionError('缺少请求内容。');
  let size = 0; const chunks = [];
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length;
    if (size > 65536) { await reader.cancel(); throw new SubmissionError('标注内容过大。', 413); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { const input = JSON.parse(new TextDecoder().decode(bytes)); if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(); return input; }
  catch { throw new SubmissionError('请求内容格式不正确。'); }
}
/** @typedef {Env & {SUBMISSIONS_OWNER_TOKEN?:string,TURNSTILE_SECRET?:string,R2_ACCESS_KEY_ID?:string,R2_SECRET_ACCESS_KEY?:string}} SubmissionEnv */
/** @typedef {{locationIds:string[],buildingIds:string[],bounds:number[]}} SubmissionCampus */
/** @typedef {{ now?:()=>number, verify?:(token:string,request:Request)=>Promise<boolean>, sign?:(row:any,receipt:string)=>Promise<string> }} Dependencies */

/** @param {SubmissionEnv} env @param {string} token @param {Request} request */
async function verifyTurnstile(env, token, request) {
  if (!env.TURNSTILE_SECRET || !env.TURNSTILE_HOSTNAMES) throw new SubmissionError('投稿验证尚未配置，请联系管理员。', 503, 'NOT_CONFIGURED');
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  const ip = request.headers.get('CF-Connecting-IP'); if (ip) form.set('remoteip', ip);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method:'POST', body:form, signal:AbortSignal.timeout(8000) });
  const result = /** @type {{success:boolean,action?:string,hostname?:string}} */ (await response.json());
  return response.ok && result.success === true && result.action === 'photo-submit'
    && String(env.TURNSTILE_HOSTNAMES).split(',').map(s=>s.trim()).includes(result.hostname || '');
}
/** @param {SubmissionEnv} env @param {any} row */
async function signUpload(env, row) {
  if (!env.R2_ACCOUNT_ID || !env.R2_BUCKET_NAME || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) throw new SubmissionError('投稿存储尚未配置，请联系管理员。', 503, 'NOT_CONFIGURED');
  const client = new AwsClient({ accessKeyId:env.R2_ACCESS_KEY_ID, secretAccessKey:env.R2_SECRET_ACCESS_KEY, region:'auto', service:'s3' });
  const url = new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${row.object_key}`);
  // Browser supplies the exact Content-Length for a Blob upload; both size and type are signed.
  url.searchParams.set('X-Amz-Expires','300');
  const signed = await client.sign(url, { method:'PUT', headers:{ 'Content-Type':row.content_type,'Content-Length':String(row.size) }, aws:{ signQuery:true, allHeaders:true, datetime:new Date(Number(row.upload_expires)-300000).toISOString().replace(/[:-]|\.\d{3}/g,'') } });
  return signed.url;
}
/** @param {Request} request @param {SubmissionEnv} env @param {SubmissionCampus} campus @param {Dependencies} [deps] */
export async function handleSubmissions(request, env, campus, deps = {}) {
  const url = new URL(request.url), admin = url.pathname.startsWith('/api/submissions/admin/');
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGINS.split(',').map(s=>s.trim()).filter(Boolean);
  if ((!admin && (!origin || !allowed.includes(origin))) || (admin && origin)) return Response.json({ error:'网站来源未获允许。' },{status:403});
  const headers = { 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff', ...(origin ? { 'Access-Control-Allow-Origin':origin,'Vary':'Origin' } : {}) };
  /** @param {unknown} value @param {number} [status] */
  const json = (value,status=200) => Response.json(value,{status,headers});
  if (request.method === 'OPTIONS' && !admin) return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET,POST','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'}});
  const now = deps.now?.() ?? Date.now();
  try {
    if (admin) {
      const provided = request.headers.get('Authorization')?.replace(/^Bearer /,'') || '';
      if (!env.SUBMISSIONS_OWNER_TOKEN || !provided || !await safeEqual(provided,env.SUBMISSIONS_OWNER_TOKEN)) throw new SubmissionError('审核身份验证失败。',403,'UNAUTHORIZED');
      if (url.pathname === '/api/submissions/admin/list' && request.method === 'GET') {
        const cursor = /^(\d+):([a-f0-9-]{36})$/.exec(url.searchParams.get('before') || '');
        const before = cursor ? Number(cursor[1]) : Number.MAX_SAFE_INTEGER, beforeID = cursor?.[2] || '~';
        const result = await env.DB.prepare("SELECT id,filename,size,annotation,status,created_at,submitted_at,upload_expires,photo_id,reason FROM submissions WHERE status='pending' AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC,id DESC LIMIT 51").bind(before,before,beforeID).all();
        const rows = result.results.slice(0,50);
        return json({ submissions:rows.map(row=>({...row,annotation:JSON.parse(String(row.annotation)), ready:now >= Number(row.upload_expires)})), nextBefore:result.results.length > 50 ? String(rows.at(-1)?.created_at)+':'+String(rows.at(-1)?.id) : null });
      }
      const match = /^\/api\/submissions\/admin\/([a-f0-9-]{36})\/(file|decision|record)$/.exec(url.pathname);
      if (!match || !UUID.test(match[1])) throw new SubmissionError('审核操作不存在。',404);
      const row = await env.DB.prepare('SELECT * FROM submissions WHERE id=?').bind(match[1]).first();
      if (!row) throw new SubmissionError('投稿不存在。',404);
      if (match[2] === 'record' && request.method === 'GET') return json({id:row.id,size:row.size,filename:row.filename,status:row.status,photoId:row.photo_id,annotation:JSON.parse(String(row.annotation))});
      if (match[2] === 'file' && request.method === 'GET') {
        if (row.status !== 'pending' || now < Number(row.upload_expires)) throw new SubmissionError('上传链接尚未过期，请稍候再导入原片。',409,'UPLOAD_SETTLING');
        const object = await env.UPLOADS.get(String(row.object_key));
        if (!object || object.size !== Number(row.size) || object.etag !== row.object_etag) throw new SubmissionError('原片发生变化，请退回该投稿后重新提交。',409,'FILE_CHANGED');
        return new Response(object.body,{headers:{...headers,'Content-Type':String(row.content_type),'Content-Length':String(object.size)}});
      }
      if (match[2] === 'decision' && request.method === 'POST') {
        const input = await readJSON(request);
        if (!['approved','rejected'].includes(input.status) || (input.status==='approved' && !UUID.test(input.photoId || ''))) throw new SubmissionError('审核结果无效。');
        if (row.status === input.status && (input.status === 'rejected' || row.photo_id === input.photoId)) return json({ ok:true });
        if (row.status !== 'pending') throw new SubmissionError('该投稿已审核，请刷新列表。',409);
        if (now < Number(row.upload_expires)) throw new SubmissionError('上传链接尚未过期，请稍后审核。',409,'UPLOAD_SETTLING');
        const reason = text(input.reason || '', 1000,'退回原因');
        const result = await env.DB.prepare("UPDATE submissions SET status=?,reviewed_at=?,photo_id=?,reason=? WHERE id=? AND status='pending'").bind(input.status,now,input.photoId || null,reason,row.id).run();
        if (!result.meta.changes) throw new SubmissionError('审核状态已变化，请刷新。',409);
        // Object removal runs in the scheduled cleanup. Decision remains durable even if R2 is unavailable.
        return json({ok:true});
      }
      throw new SubmissionError('请求方式不支持。',405);
    }
    if (url.pathname === '/api/submissions/config' && request.method === 'GET') return json({ maxBytes:MAX_PHOTO_BYTES, enabled: !!(deps.verify && deps.sign || env.TURNSTILE_SECRET && env.TURNSTILE_HOSTNAMES && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_ACCOUNT_ID && env.SUBMISSIONS_OWNER_TOKEN && env.SUBMISSIONS_OWNER_TOKEN.length >= 32), local:!!deps.verify });
    if (request.method !== 'POST') throw new SubmissionError('请求方式不支持。',405);
    if (!(await env.SUBMISSIONS_LIMITER.limit({key:request.headers.get('CF-Connecting-IP') || 'unknown'})).success) throw new SubmissionError('提交操作太频繁，请一分钟后再试。当前标注已保留。',429,'RATE_LIMIT');
    const input = await readJSON(request);
    if (!UUID.test(input.id || '') || typeof input.receipt !== 'string' || !/^[a-f0-9]{64}$/.test(input.receipt)) throw new SubmissionError('投稿凭证无效。');
    const receiptHash = await hashReceipt(input.receipt);
    const row = await env.DB.prepare('SELECT * FROM submissions WHERE id=? AND receipt_hash=?').bind(input.id,receiptHash).first();
    if (url.pathname === '/api/submissions/status') {
      if (!row) throw new SubmissionError('没有找到这份投稿。',404);
      return json({status:row.status,reason:row.reason,photoId:row.photo_id});
    }
    if (url.pathname === '/api/submissions/complete') {
      if (!row) throw new SubmissionError('投稿会话已失效，请重新提交。',404);
      if (row.status !== 'uploading') return json({status:row.status,id:row.id});
      if (now > Number(row.upload_expires)) throw new SubmissionError('上传会话已过期，请重新提交。标注已保留。',410,'UPLOAD_EXPIRED');
      const object = await env.UPLOADS.head(String(row.object_key));
      if (!object || object.size !== Number(row.size)) throw new SubmissionError('尚未收到完整照片，请重试上传。',409,'UPLOAD_INCOMPLETE');
      await env.DB.prepare("UPDATE submissions SET status='pending',submitted_at=?,object_etag=? WHERE id=? AND status='uploading'").bind(now,object.etag,row.id).run();
      return json({status:'pending',id:row.id});
    }
    if (url.pathname !== '/api/submissions/start') throw new SubmissionError('接口不存在。',404);
    if (!env.SUBMISSIONS_OWNER_TOKEN || env.SUBMISSIONS_OWNER_TOKEN.length < 32) throw new SubmissionError('审核服务尚未配置，请联系管理员。',503,'NOT_CONFIGURED');
    const annotation = validateAnnotation(input.annotation,campus);
    const filename = text(input.filename,200,'文件名');
    if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > MAX_PHOTO_BYTES) throw new SubmissionError('照片大小须在 40 MB 以内。',413);
    if (!MIMES.has(input.contentType)) throw new SubmissionError('请选择支持的照片格式。',415);
    if (row) {
      if (row.status !== 'uploading') return json({status:row.status,id:row.id});
      if (Number(row.upload_expires) < now) throw new SubmissionError('上传会话已过期，请重新提交。',410,'UPLOAD_EXPIRED');
      if (row.size !== input.size || row.content_type !== input.contentType || row.annotation !== JSON.stringify(annotation)) throw new SubmissionError('资料已改变，请重新开始提交。',409,'SESSION_CHANGED');
      // Never extend the first expiry: existing PUT URLs can be replayed until their signed expiry.
      return json({status:'uploading',id:row.id,uploadURL:await (deps.sign ? deps.sign(row,input.receipt) : signUpload(env,row)),expiresAt:row.upload_expires});
    }
    if (typeof input.turnstileToken !== 'string' || !input.turnstileToken || !(await (deps.verify ? deps.verify(input.turnstileToken,request) : verifyTurnstile(env,input.turnstileToken,request)))) throw new SubmissionError('人机验证未通过，请重新验证后提交。',403,'VERIFICATION_FAILED');
    const created = {id:input.id,receipt_hash:receiptHash,object_key:'pending/'+input.id+'/source',filename,content_type:input.contentType,size:input.size,annotation:JSON.stringify(annotation),upload_expires:now+300000};
    // Sign before reserving budget. A configuration failure must not consume a slot.
    const uploadURL = await (deps.sign ? deps.sign(created,input.receipt) : signUpload(env,created));
    const day = new Date(now).toISOString().slice(0,10), maxStorage=Number(env.MAX_STORAGE_BYTES), maxCount=Number(env.MAX_DAILY_SUBMISSIONS), maxDailyBytes=Number(env.MAX_DAILY_UPLOAD_BYTES);
    if (input.size > maxDailyBytes) throw new SubmissionError('照片超过今日剩余上传额度，请稍后重试。',429,'DAILY_SUBMISSION_LIMIT');
    if (![maxStorage,maxCount,maxDailyBytes].every(n=>Number.isSafeInteger(n) && n>0)) throw new SubmissionError('投稿限额尚未配置。',503,'NOT_CONFIGURED');
    const result = await env.DB.batch([
      env.DB.prepare(`UPDATE submission_budget SET reserved_bytes=reserved_bytes+?,day=?,daily_count=CASE WHEN day=? THEN daily_count+1 ELSE 1 END,daily_bytes=CASE WHEN day=? THEN daily_bytes+? ELSE ? END WHERE id=1 AND reserved_bytes+? <= ? AND (day<>? OR (daily_count < ? AND daily_bytes+? <= ?))`).bind(input.size,day,day,day,input.size,input.size,input.size,maxStorage,day,maxCount,input.size,maxDailyBytes),
      env.DB.prepare(`INSERT INTO submissions(id,receipt_hash,object_key,filename,content_type,size,annotation,status,created_at,upload_expires) SELECT ?,?,?,?,?,?,?,'uploading',?,? WHERE changes()=1`).bind(created.id,created.receipt_hash,created.object_key,filename,created.content_type,created.size,created.annotation,now,created.upload_expires)
    ]);
    if (!result[1].meta.changes) {
      const budget = await env.DB.prepare('SELECT * FROM submission_budget WHERE id=1').first();
      const storageFull = Number(budget?.reserved_bytes)+input.size > maxStorage;
      const resetDate = new Date(new Date(day+'T00:00:00Z').getTime()+86400000).toISOString().slice(0,10);
      throw new SubmissionError(storageFull ? '待审核照片空间已满，管理员清理后才能继续提交。当前标注已保留。' : '今天的投稿额度已用完，请在北京时间 '+resetDate+' 08:00 后重试。当前标注已保留。',429,storageFull ? 'STORAGE_LIMIT':'DAILY_SUBMISSION_LIMIT');
    }
    return json({status:'uploading',id:created.id,uploadURL,expiresAt:created.upload_expires},201);
  } catch (error) {
    if (error instanceof SubmissionError) return json({error:error.message,code:error.code},error.status);
    console.error(JSON.stringify({event:'submission_request_failed',admin,method:request.method}));
    return json(serviceFailure(error),503);
  }
}
/** @param {SubmissionEnv} env @param {number} [now] */
export async function cleanupSubmissions(env, now=Date.now()) {
  // Expired sessions and finished reviews are removed only after all upload URLs expire.
  const rows = await env.DB.prepare(`SELECT id,object_key,size,status FROM submissions WHERE released=0 AND upload_expires < ? AND (status IN ('uploading','approved','rejected','expired') OR (status='pending' AND submitted_at < ?)) LIMIT 50`).bind(now,now-30*86400000).all();
  for (const row of rows.results) {
    await env.UPLOADS.delete(String(row.object_key));
    await env.DB.batch([
      env.DB.prepare("UPDATE submissions SET released=1,status=CASE WHEN status IN ('uploading','pending') THEN 'expired' ELSE status END WHERE id=? AND released=0").bind(row.id),
      env.DB.prepare('UPDATE submission_budget SET reserved_bytes=MAX(0,reserved_bytes-?) WHERE id=1 AND changes()=1').bind(row.size)
    ]);
  }
  // Keep receipts for 90 days; pending private originals are retained for at most 30 days.
  await env.DB.prepare('DELETE FROM submissions WHERE released=1 AND created_at < ?').bind(now-90*86400000).run();
}
