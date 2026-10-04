import { handleLikes } from '../worker/src/likes.mjs';
import { handleSubmissions, hashReceipt, MAX_PHOTO_BYTES } from '../worker/src/submissions.mjs';
import { serviceFailure } from '../worker/src/service-errors.mjs';
import { submissionPlatform, closeSubmissionPlatforms } from './submission-platform.mjs';
import { isLocalRequest } from './local-editor.mjs';
import { createStore } from './storage.mjs';
export function localLikesPlugin() {
  return { name:'local-photo-services', configureServer(server) {
    const root=server.config.root,store=createStore(process.env.CAMPUS_CONTENT_ROOT || root);
    server.middlewares.use(async(req,res,next)=>{
      if (!req.url?.startsWith('/api/likes/') && !req.url?.startsWith('/api/submissions/')) return next();
      const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
      if (!isLocalRequest(req)) return send(403,{error:'本地服务只接受本机请求。'});
      try {
        const platform=await submissionPlatform(root),origin='http://'+req.headers.host;
        const url=new URL(req.url,origin);
        if (url.pathname.includes('/admin/')) return send(403,{error:'请在本地编辑器审核。'});
        const upload=/^\/api\/submissions\/local-upload\/([a-f0-9-]{36})$/.exec(url.pathname);
        const maximum=upload ? MAX_PHOTO_BYTES : 65536;
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>maximum)return send(413,{error:'文件或内容过大。'});chunks.push(chunk);}
        if (upload) {
          if(req.method!=='PUT')return send(405,{error:'请求方式不支持。'});
          const receipt=url.searchParams.get('receipt') || '';
          if(!/^[a-f0-9]{64}$/.test(receipt))return send(403,{error:'上传凭证无效。'});
          const row=await platform.env.DB.prepare('SELECT * FROM submissions WHERE id=? AND receipt_hash=?').bind(upload[1],await hashReceipt(receipt)).first();
          if(!row || row.status!=='uploading' || row.upload_expires < Date.now()) return send(410,{error:'上传会话已过期。',code:'UPLOAD_EXPIRED'});
          if(size!==row.size || req.headers['content-type']!==row.content_type)return send(400,{error:'照片大小或格式不匹配。'});
          await platform.env.UPLOADS.put(row.object_key,Buffer.concat(chunks),{httpMetadata:{contentType:row.content_type}});
          return send(200,{ok:true});
        }
        const headers=new Headers({'Content-Type':req.headers['content-type'] || '',Origin:req.headers.origin || origin,'CF-Connecting-IP':'127.0.0.1'});
        const request=new Request(origin+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
        const env={...platform.env,ALLOWED_ORIGINS:origin};
        const response=url.pathname.startsWith('/api/submissions/') ? await handleSubmissions(request,env,platform.campus,platform.deps)
          : await handleLikes(request,env,new Set((await store.state()).site.photos.map(p=>p.id)));
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
      }catch(e){server.config.logger.error('Local service failed: '+e.message);send(503,serviceFailure(e));}
    });
  },closeBundle:closeSubmissionPlatforms};
}
