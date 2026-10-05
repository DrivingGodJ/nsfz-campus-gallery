import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { createReviewService } from './submission-review.mjs';
import { createStore, ID_PATTERN, MAX_UPLOAD, UserError } from './storage.mjs';
import { importPhotoPackage } from './package-import.mjs';
import { MAX_DEPTH_BYTES, MAX_PACKAGE_BYTES } from './photo-package.mjs';
import { createPublicationService } from './local-publication.mjs';

async function body(req, maximum) {
  const chunks = [];
  let count = 0;
  for await (const chunk of req) {
    count += chunk.length;
    if (count > maximum) throw new UserError('文件或内容过大。', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function isLocalRequest(req) {
  const host = req.headers.host || '';
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return false;
  const origin = req.headers.origin;
  if (origin && origin !== 'http://' + host) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  return true;
}
export function localEditorPlugin() {
  const token = crypto.randomBytes(32).toString('hex');
  let store, review, publication;
  return {
    name: 'nsfz-local-editor',
    transformIndexHtml(html, context) {
      if (!context.path.endsWith('editor.html')) return html;
      return html.replace('<head>', '<head><meta name="local-editor-token" content="' + token + '">');
    },
    configureServer(server) {
      store = createStore(process.env.CAMPUS_CONTENT_ROOT || server.config.root);
      review = createReviewService(store, server.config.root);
      publication = createPublicationService(store.root);
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        if (!url.pathname.startsWith('/__local/')) return next();
        const send = (status, value) => {
          res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(value));
        };
        try {
          if (!isLocalRequest(req)) throw new UserError('本地编辑器仅接受当前电脑上的请求。', 403);
          const segments = url.pathname.slice('/__local/'.length).split('/');
          const [resource, id, name] = segments;
          if (resource === 'draft-media' && req.method === 'GET') {
            if (!ID_PATTERN.test(id || '') || !['thumbnail.webp', 'preview.webp', 'display.webp', 'depth.webp'].includes(name) || segments.length !== 3) throw new UserError('文件不存在。', 404);
            const bytes = await fs.readFile(path.join(store.localRoot, 'draft-media', id, name));
            res.setHeader('Content-Type', 'image/webp'); res.setHeader('Cache-Control', 'no-store'); return res.end(bytes);
          }
          if (req.headers['x-local-editor-token'] !== token) throw new UserError('本地编辑会话已过期，请刷新页面。', 403);
          if (resource === 'release') {
            if (id === 'status' && req.method === 'GET') return send(200, await publication.status());
            if (id === 'start' && req.method === 'POST') return send(202, await publication.start());
            throw new UserError('上线操作不存在。', 404);
          }
          if (req.method !== 'GET' && await publication.publishing()) throw new UserError('正在上线，请等待完成后再修改内容。', 423);
          if (resource === 'review') {
            if (id === 'config' && req.method === 'GET') return send(200, await review.config());
            if (id === 'config' && req.method === 'PUT') return send(200, await review.configure(JSON.parse((await body(req,8192)).toString())));
            if (id === 'list' && req.method === 'GET') return send(200, await review.list(url.searchParams.get('before') || ''));
            if (!ID_PATTERN.test(id || '') || req.method !== 'POST') throw new UserError('审核操作不存在。',404);
            const value = JSON.parse((await body(req,65536)).toString() || '{}');
            if (name === 'import') return send(200, await review.importSubmission(id));
            if (name === 'approve') return send(200, await review.approve(id,value.photo,value.revision));
            if (name === 'reject') return send(200, await review.reject(id,value.reason || ''));
            throw new UserError('审核操作不存在。',404);
          }
          if (resource === 'state' && req.method === 'GET') return send(200, { ...await store.state(), reviewImports: await review.imports() });
          if (resource === 'import-package' && req.method === 'POST') return send(201, await importPhotoPackage(store, await body(req, MAX_PACKAGE_BYTES)));
          if (resource === 'import' && req.method === 'POST') {
            const draft = await store.importPhoto(await body(req, MAX_UPLOAD));
            let filename = '';
            try { filename = decodeURIComponent(req.headers['x-photo-filename'] || ''); } catch {}
            if (filename) draft.title = path.basename(filename).replace(/\.[^.]+$/, '').slice(0, 160) || '未命名照片';
            await store.updateDraft(draft.id, draft);
            return send(201, { photo: draft });
          }
          if (resource === 'buildings' && req.method === 'PUT') {
            const input = JSON.parse((await body(req, 1024 * 1024)).toString());
            await store.updateBuildings(input.overrides, input.revision); return send(200, { ok: true });
          }
          if (resource === 'photo' && name === 'depth' && segments.length === 3 && ID_PATTERN.test(id || '')) {
            const revisionValue = url.searchParams.has('revision') ? Number(url.searchParams.get('revision')) : undefined;
            if (req.method === 'PUT') return send(200, { photo: await store.setPhotoDepth(id, await body(req, MAX_DEPTH_BYTES), revisionValue) });
            if (req.method === 'DELETE') return send(200, { photo: await store.setPhotoDepth(id, null, revisionValue) });
          }
          if (!ID_PATTERN.test(id || '') || segments.length !== 2) throw new UserError('请求地址不正确。', 404);
          const input = req.method === 'GET' ? {} : JSON.parse((await body(req, 1024 * 1024)).toString() || '{}');
          if (resource === 'draft' && req.method === 'PUT') return send(200, { photo: await store.updateDraft(id, input.photo) });
          if (resource === 'publish' && req.method === 'POST') return send(200, { photo: await store.publish(id, input.revision) });
          if (resource === 'photo' && req.method === 'PUT') return send(200, { photo: await store.updatePhoto(id, input.photo, input.revision) });
          if (resource === 'photo' && req.method === 'DELETE') { await store.removePhoto(id, input.revision); return send(200, { ok: true }); }
          if (resource === 'restore' && req.method === 'POST') { await store.restorePhoto(id, input.revision); return send(200, { ok: true }); }
          throw new UserError('操作不存在。', 404);
        } catch (error) {
          if (error.code === 'ENOENT') return send(404, { error: '找不到文件，请重新导入照片。' });
          if (error instanceof SyntaxError) return send(400, { error: '内容格式不正确。' });
          if (!(error instanceof UserError)) server.config.logger.error(String(error.stack || error));
          send(error.status || 500, { error: error instanceof UserError ? error.message : '保存失败，现有内容已保留，请重试。' });
        }
      });
    }
  };
}
