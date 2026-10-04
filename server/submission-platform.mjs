import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getPlatformProxy } from 'wrangler';
import { handleSubmissions, cleanupSubmissions } from '../worker/src/submissions.mjs';
const platforms = new Map();
export async function submissionPlatform(root) {
  if (!platforms.has(root)) platforms.set(root,(async()=>{
    const proxy = await getPlatformProxy({configPath:path.join(root,'worker/wrangler.jsonc'),persist:{path:path.join(process.env.CAMPUS_CONTENT_ROOT || root,'.local/likes-db')},remoteBindings:false});
    try {
      for (const name of ['0001_likes.sql','0002_submissions.sql']) {
        const sql=await fs.readFile(path.join(root,'worker/migrations',name),'utf8');
        for (const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)) await proxy.env.DB.prepare(statement).run();
      }
      const campus=JSON.parse(await fs.readFile(path.join(root,'worker/src/submission-campus.json'),'utf8'));
      const ownerToken=crypto.randomBytes(32).toString('hex');
      const env={...proxy.env,SUBMISSIONS_OWNER_TOKEN:ownerToken};
      const deps={verify:async(token)=> token==='local-development-only',sign:async(row,receipt)=>`/api/submissions/local-upload/${row.id}?receipt=${receipt}`};
      return {proxy,env,campus,deps,handle:async(request)=>handleSubmissions(request,env,campus,deps),cleanup:()=>cleanupSubmissions(env)};
    } catch(e) { await proxy.dispose(); platforms.delete(root); throw e; }
  })());
  return platforms.get(root);
}
export async function closeSubmissionPlatforms() { for (const value of platforms.values()) await (await value).proxy.dispose(); platforms.clear(); }
