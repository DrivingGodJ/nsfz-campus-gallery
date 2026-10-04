import { useEffect, useState } from 'react';
import { RefreshCw, Download, Settings2 } from 'lucide-react';
import type { ReviewConfiguration, Submission } from './submission-types';
export default function ReviewInbox({api, onImport, onReject, onError, busy, reload, onRecords}: {
  api:(route:string,method?:string,value?:unknown)=>Promise<any>;onImport:(row:Submission)=>void;onReject:(row:Submission,reason:string)=>void;
  onError:(message:string)=>void;busy:boolean;reload:number;onRecords:(rows:Submission[])=>void;
}) {
  const [rows,setRows]=useState<Submission[]>([]),[loading,setLoading]=useState(false),[cursor,setCursor]=useState<string>('');
  const [config,setConfig]=useState<ReviewConfiguration|null>(null),[settings,setSettings]=useState(false),[url,setURL]=useState(''),[secret,setSecret]=useState('');
  const [rejectID,setRejectID]=useState(''),[reason,setReason]=useState('');
  const [clock,setClock]=useState(Date.now());
  const load=async(more=false)=>{setLoading(true);try{const result=await api('review/list'+(more && cursor?'?before='+encodeURIComponent(cursor):''));const list=more?[...rows,...result.submissions]:result.submissions;setRows(list);onRecords(list);setCursor(result.nextBefore?String(result.nextBefore):'');setConfig(result.config);setURL(result.config.url);}catch(e){onError((e as Error).message);}finally{setLoading(false);}};
  useEffect(()=>{void load();},[reload]);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const configure=async(mode:'local'|'cloud')=>{try{await api('review/config','PUT',{mode,url,ownerToken:secret});setSecret('');setSettings(false);await load();}catch(e){onError((e as Error).message);}};
  return <><div className="review-heading"><strong>待审核投稿</strong><button className="icon-button" aria-label="刷新投稿列表" disabled={loading||busy} onClick={()=>void load()}><RefreshCw size={16}/></button></div>
    <p className="library-help">{config?.mode==='cloud'?'正在连接线上投稿服务。':'本地体验：投稿和审核都在这台电脑，尚未开放线上投稿。'}审核通过后加入内容库，公开发布仍需更新网站。</p>
    <button className="text-button" onClick={()=>setSettings(!settings)}><Settings2 size={14}/>审核服务设置</button>
    {settings && <form className="review-settings" onSubmit={e=>{e.preventDefault();void configure('cloud');}}><label>线上投稿服务地址<input type="url" value={url} placeholder="https://服务名称.workers.dev" onChange={e=>setURL(e.target.value)} required/></label><label>审核密钥<input type="password" autoComplete="off" value={secret} onChange={e=>setSecret(e.target.value)} required minLength={32}/></label><p className="field-help">仅保存在此电脑的本地配置，不会上传到公开网站。</p><button className="button primary" type="submit">连接线上服务</button><button className="button secondary" type="button" onClick={()=>void configure('local')}>使用本地体验</button></form>}
    {loading && <p className="library-help" role="status">正在读取投稿…</p>}
    {!loading && rows.length===0 && <p className="library-help">暂无待审核照片。你自己的照片可在“照片”页批量导入，直接入库。</p>}
    {rows.map(row=>{const seconds=Math.max(0,Math.ceil((row.upload_expires-clock)/1000));return <div className="review-row" key={row.id}><button className="review-import" onClick={()=>onImport(row)} disabled={busy||seconds>0}><strong>{row.annotation.title}</strong><small>{row.filename} · {(row.size/1024/1024).toFixed(1)} MB</small><small>{new Date(row.created_at).toLocaleString('zh-CN')}</small><span><Download size={13}/>{seconds>0?'上传保护中 · '+seconds+' 秒':row.needsSync?'已入库 · 待同步':row.localPhotoId?'继续审核':'导入原片审核'}</span></button>{seconds===0 && !row.needsSync && <><button className="text-button" onClick={()=>{setRejectID(row.id);setReason('');}} disabled={busy}>退回投稿</button>{rejectID===row.id && <><label>退回原因<textarea maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="button secondary" onClick={()=>{onReject(row,reason);setRejectID('');}} disabled={busy}>确认退回</button></>}</>}</div>;})}
    {cursor && <button className="button secondary full-width" onClick={()=>void load(true)} disabled={loading||busy}>加载更多</button>}
  </>;
}
