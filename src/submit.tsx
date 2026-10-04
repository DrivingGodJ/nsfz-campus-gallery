import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, Crosshair, ImagePlus, Send, Columns2, Download } from 'lucide-react';
import { Brand, Notice } from './components';
import { loadContent, headingText, type Campus, type Site, type Photo } from './types';
import { assignPhotoLocation, campusFilterLocations, photoLocationId, isAerialPhoto } from './locations';
import LocationOptions from './LocationOptions';
import PhotoPositionFields from './PhotoPositionFields';
import PhotoComparison from './PhotoComparison';
import PhotoImage from './PhotoImage';
import { PhotoPerspectiveButton } from './PhotoPerspective';
import Turnstile from './Turnstile';
import { extractPhotoMetadata } from '../server/photo-metadata.mjs';
import { automaticPhotoPlacement } from '../server/photo-geolocation.mjs';
import { createSubmissionsClient, newSubmissionSession, photoAnnotation, uploadOriginal, type UploadSession } from './submissions-api';
import './styles.css';
const MapView=React.lazy(()=>import('./MapView'));
const local=import.meta.env.DEV,serviceURL=local?'':(import.meta.env.VITE_SUBMISSIONS_API_URL || ''),siteKey=import.meta.env.VITE_TURNSTILE_SITE_KEY || '';
const client=createSubmissionsClient(serviceURL);
const CACHE='nsfz:submission:draft',RECEIPTS='nsfz:submission:receipts';
function Submit() {
  const [content,setContent]=useState<{campus:Campus;site:Site}|null>(null),[photo,setPhoto]=useState<Photo|null>(null),[file,setFile]=useState<File|null>(null),[image,setImage]=useState('');
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(''),[placing,setPlacing]=useState(false),[comparing,setComparing]=useState(false),[perspective,setPerspective]=useState(false);
  const [verified,setVerified]=useState(''),[reset,setReset]=useState(0),[configured,setConfigured]=useState(false),[session,setSession]=useState<UploadSession|null>(null),[submitted,setSubmitted]=useState(false),[status,setStatus]=useState('');
  const [receipts,setReceipts]=useState<UploadSession[]>(()=>{try{return JSON.parse(localStorage.getItem(RECEIPTS)||'[]');}catch{return [];}});
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{void loadContent().then(setContent).catch(e=>setError(e.message));if(!local && (!serviceURL || !siteKey)){setError('线上投稿尚未开放，请稍后再来。');return;}void client.config().then(result=>{setConfigured(result.enabled);if(!result.enabled)setError('投稿服务尚未准备好，请稍后再来。');}).catch(e=>setError(e.message));},[]);
  useEffect(()=>()=>{if(image)URL.revokeObjectURL(image);},[image]);
  useEffect(()=>{const handler=(e:BeforeUnloadEvent)=>{if(photo&&!submitted){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[photo,submitted]);
  const persist=(next:Photo,nextSession:UploadSession|null)=>{try{localStorage.setItem(CACHE,JSON.stringify({photo:next,session:nextSession,filename:file?.name,size:file?.size,lastModified:file?.lastModified}));}catch{setError('浏览器暂存空间不足。请下载标注备份，当前内容仍在页面中。');}};
  const change=(update:Partial<Photo>)=>{if(!photo || busy || submitted)return;const next={...photo,...update};setPhoto(next);setSession(null);persist(next,null);};
  const choose=async(source:File)=>{
    if(!content || busy)return;setError('');setMessage('');
    if(!source.size || source.size>40*1024*1024){setError('单张照片最多 40 MB，请先缩小原片。');return;}
    if(!['image/jpeg','image/png','image/webp','image/avif'].includes(source.type)){setError('网页投稿支持 JPEG、PNG、WebP、AVIF。其他原片可用本地工具导入。');return;}
    setBusy('正在读取照片资料');const sourceURL=URL.createObjectURL(source);
    try {
      const dimensions=await new Promise<{width:number;height:number}>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve({width:img.naturalWidth,height:img.naturalHeight});img.onerror=()=>reject(new Error('照片无法预览，请换成 JPEG 或 PNG。'));img.src=sourceURL;});
      if(dimensions.width*dimensions.height>70000000)throw new Error('照片像素过大，请缩小到 7000 万像素以内。');
      const metadata=await extractPhotoMetadata(source);
      let next:Photo={id:crypto.randomUUID(),title:source.name.replace(/\.[^.]+$/,''),description:'',capturedAt:metadata.recordedAt || '',author:metadata.author || '',copyright:metadata.copyright || '',metadata,buildingId:'',locationId:'',floor:0,...automaticPhotoPlacement(metadata,content.campus),heading:0,pitch:0,...dimensions,downloadBytes:source.size,files:{thumbnail:'',display:'',download:''}};
      let cached;try{cached=JSON.parse(localStorage.getItem(CACHE)||'null');}catch{}
      let restoredSession=null;
      if(cached?.filename===source.name && cached.size===source.size && cached.lastModified===source.lastModified && cached.photo) {
        next={...next,...cached.photo,metadata,id:next.id,files:next.files,width:next.width,height:next.height};restoredSession=cached.session || null;setMessage('已恢复这张照片上次暂存的标注。');
      }
      setFile(source);setPhoto(next);setImage(sourceURL);setSession(restoredSession);setPlacing(!next.placed);setSubmitted(false);setComparing(false);setPerspective(false);setStatus('');
      try{localStorage.setItem(CACHE,JSON.stringify({photo:next,session:restoredSession,filename:source.name,size:source.size,lastModified:source.lastModified}));}catch{}
    }catch(e){URL.revokeObjectURL(sourceURL);setError((e as Error).message);}finally{setBusy('');if(input.current)input.current.value='';}
  };
  const saveReceipt=(value:UploadSession)=>{setReceipts(previous=>{const list=[value,...previous.filter(item=>item.id!==value.id)].slice(0,30);try{localStorage.setItem(RECEIPTS,JSON.stringify(list));}catch{setError('投稿已完成，但凭证未能自动保存。请下载投稿凭证。');}return list;});};
  const submit=async()=>{
    if(!photo || !file || busy || !configured)return;setError('');setMessage('');
    let current=session;
    const signature=JSON.stringify(photoAnnotation(photo));
    if(!current || current.signature!==signature || (current.expiresAt && current.expiresAt<Date.now()))current={...newSubmissionSession(),signature,filename:file.name};
    setSession(current);persist(photo,current);setBusy('正在申请上传');
    try {
      const started=await client.start(current,file,photo,local?'local-development-only':verified);
      if(started.status==='pending' || started.status==='approved'){setSubmitted(true);saveReceipt(current);localStorage.removeItem(CACHE);setMessage('这份投稿已经收到，请勿重复提交。');return;}
      if(started.status!=='uploading')throw new Error('该投稿已结束，请重新选择照片后提交。');
      current={...current,expiresAt:started.expiresAt};setSession(current);persist(photo,current);
      if(!current.uploaded){await uploadOriginal(started.uploadURL,file,progress=>setBusy('正在上传原片 · '+Math.round(progress*100)+'%'));current={...current,uploaded:true};setSession(current);persist(photo,current);}
      setBusy('正在确认投稿');const result=await client.complete(current);
      if(result.status!=='pending' && result.status!=='approved')throw new Error('投稿尚未确认，请重试。');
      setSubmitted(true);setPlacing(false);saveReceipt(current);localStorage.removeItem(CACHE);setMessage('投稿成功，照片进入待审核区。审核通过并发布后才会出现在网站。');
    }catch(e){setError((e as Error).message);}finally{setBusy('');setVerified('');setReset(n=>n+1);}
  };
  const download=(value:unknown,name:string)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const check=async(receipt:UploadSession)=>{setBusy('正在查询审核状态');setError('');try{const result=await client.status(receipt);const labels:Record<string,string>={uploading:'原片尚未确认上传',pending:'待审核',approved:'审核通过，等待网站发布',rejected:'投稿已退回',expired:'投稿已过期，请重新提交'};setStatus((receipt.filename || '照片')+'：'+(labels[result.status] || result.status)+(result.reason?'。原因：'+result.reason:''));}catch(e){setError((e as Error).message);}finally{setBusy('');}};
  const location=photo&&content?photoLocationId(photo,content.campus):'',locationIds=content?campusFilterLocations(content.campus,content.site).map(l=>l.id):[];
  const allowed=!location || locationIds.includes(location);
  const canSubmit=!!photo?.placed&&!!photo.title.trim()&&allowed&&(!isAerialPhoto(photo)||!!photo.altitude)&&configured&&(local||!!verified||!!session?.expiresAt);
  return <div className="app submission-app"><header className="app-header"><Brand/><span className="local-badge">投稿照片</span><div className="header-actions"><a className="button secondary" href="./"><ArrowLeft size={15}/>返回校园</a></div></header>
    {local && <Notice kind="success">本地体验 · 投稿保存在此电脑。线上服务将在网站发布时连接。</Notice>}
    {error && <Notice kind="error">{error}<button className="text-button" onClick={()=>setError('')}>关闭</button></Notice>}
    {message && <Notice kind="success">{message}</Notice>}{status && <Notice kind="success">{status}</Notice>}
    {busy && <div className="busy-bar" role="status">{busy}</div>}
    <main className={'submission-main'+(comparing?' comparing':'')}><div className="submission-map"><PhotoComparison photo={comparing?photo:null} imageSource={image} navigation={<button className="button secondary" onClick={()=>{setComparing(false);setPerspective(false);}}>继续标注</button>} actions={photo && <PhotoPerspectiveButton photo={photo} active={perspective} compact editor onClick={()=>{setPerspective(!perspective);setPlacing(false);}}/>}>
      {content ? <React.Suspense fallback={<div className="page-loading">正在绘制校园…</div>}><MapView campus={content.campus} site={content.site} photos={[]} editPhoto={photo} selectedLocation={location || ''} floor={photo?.floor} selectableLocationIds={locationIds} featuresSelectable photoPreview={comparing} photoPerspective={perspective} onExitPhotoPerspective={()=>setPerspective(false)} onPhotoOrientation={change} onHeading={heading=>change({heading})} placing={placing&&!busy&&!submitted} onPlace={position=>{change({position,placed:true});setPlacing(false);}} onLocation={id=>{if(photo && locationIds.includes(id))change(assignPhotoLocation(photo,id,content.campus,content.site));}}/></React.Suspense>:<div className="page-loading">正在打开校园…</div>}
      {photo && !comparing && !submitted && <button className={'button placement-button '+(placing?'primary':'secondary')} onClick={()=>setPlacing(!placing)} disabled={!!busy}><Crosshair size={15}/>{placing?'点击地图标记位置':photo.placed?'重新标记拍摄位置':'标记拍摄位置'}</button>}
    </PhotoComparison></div>
    <aside className="submission-form"><div className="edit-form"><h1>分享一张校园照片</h1><p className="field-help">选择照片，标记位置并体验拍摄视角，再提交给管理员审核。原片只供审核，通过后公开展示处理后的照片。</p>
      <button className="button primary full-width" onClick={()=>input.current?.click()} disabled={!!busy||!content}><ImagePlus size={17}/>{photo?'选择另一张照片':'选择照片'}</button><input ref={input} type="file" className="visually-hidden" accept="image/jpeg,image/png,image/webp,image/avif" onChange={e=>{if(e.target.files?.[0])void choose(e.target.files[0]);}} aria-label="选择投稿照片"/>
      <p className="field-help">JPEG / PNG / WebP / AVIF · 单张最多 40 MB。刷新后重新选择同一原片可恢复标注。</p>
      {!configured && (local || serviceURL && siteKey) && <button className="button secondary" onClick={()=>{setError('');void client.config().then(result=>{setConfigured(result.enabled);if(!result.enabled)setError('投稿服务尚未准备好，请稍后再来。');}).catch(e=>setError(e.message));}}>重新连接投稿服务</button>}
      {photo && content && <><div className="photo-image-container"><PhotoImage className="submission-preview" src={image} alt={photo.title}/></div><button className="button secondary" onClick={()=>{setComparing(true);setPlacing(false);}}><Columns2 size={16}/>照片与模型同屏</button>
      <fieldset className="submission-fields" disabled={!!busy||submitted}><label>照片标题<input maxLength={160} value={photo.title} onChange={e=>change({title:e.target.value})}/></label><label>文字描述<textarea maxLength={10000} value={photo.description} onChange={e=>change({description:e.target.value})}/></label>
        <label>拍摄日期与时间<input type="datetime-local" step={1} value={photo.capturedAt.includes('T')?photo.capturedAt:photo.capturedAt?photo.capturedAt+'T00:00':''} onChange={e=>change({capturedAt:e.target.value})}/></label>
        <label>作者<input maxLength={200} value={photo.author || ''} placeholder="原片未提供，可留空" onChange={e=>change({author:e.target.value})}/></label><label>版权信息<textarea maxLength={3000} value={photo.copyright || ''} placeholder="原片未提供，可留空" onChange={e=>change({copyright:e.target.value})}/></label>
        <label>拍摄地点<select value={location || ''} onChange={e=>change(assignPhotoLocation(photo,e.target.value,content.campus,content.site))}><option value="">校园室外（未指定地点）</option><LocationOptions campus={content.campus} site={content.site}/></select></label>
        <PhotoPositionFields photo={photo} campus={content.campus} site={content.site} onChange={change}/>
        <details className="precision"><summary>精确水平位置</summary><div className="field-pair"><label>东西 / m<input type="number" step={.1} value={Number(photo.position.x.toFixed(1))} onChange={e=>change({position:{...photo.position,x:Number(e.target.value)},placed:true})}/></label><label>南北 / m<input type="number" step={.1} value={Number(photo.position.z.toFixed(1))} onChange={e=>change({position:{...photo.position,z:Number(e.target.value)},placed:true})}/></label></div></details>
        <label>水平朝向<span className="range-value">{headingText(photo.heading)}</span><input type="range" min={0} max={359} value={photo.heading} onChange={e=>change({heading:Number(e.target.value)})}/></label><label>仰俯角<span className="range-value">{photo.pitch.toFixed(1)}°</span><input type="range" min={-90} max={90} value={photo.pitch} onChange={e=>change({pitch:Number(e.target.value)})}/></label>
        <label>等效 35 mm 焦距 / mm<input type="number" min={1} max={10000} step={.1} value={photo.view?.focalLength35Mm ?? photo.metadata?.focalLength35Mm ?? ''} placeholder="原片无焦距时，可手动填写" onChange={e=>change({view:{...photo.view,focalLength35Mm:e.target.value?Number(e.target.value):undefined}})}/></label>
        <PhotoPerspectiveButton photo={photo} active={perspective} editor onClick={()=>{setPerspective(!perspective);setComparing(true);setPlacing(false);}}/>
      </fieldset>
      {!submitted && <>{!local && configured && <Turnstile siteKey={siteKey} onToken={setVerified} reset={reset}/>}<p className="field-help">提交表示你有权提供此照片并同意审核通过后在本站展示。缺少作者或版权元数据时保持留空。待审核原片最多保留 30 天。</p><button className="button primary full-width" onClick={()=>void submit()} disabled={!!busy||!canSubmit}><Send size={16}/>{session?'重试提交':'提交审核'}</button><button className="text-button" onClick={()=>download({annotation:photoAnnotation(photo),filename:file?.name},'照片标注备份.json')}><Download size={14}/>下载标注备份</button></>}
      {submitted && session && <button className="button secondary" onClick={()=>download(session,'投稿凭证-'+session.id+'.json')}>下载投稿凭证</button>}
      </>}
      {<details className="submission-receipts"><summary>我的投稿记录</summary>{receipts.map(receipt=><div key={receipt.id}><span>{receipt.filename || receipt.id.slice(0,8)}</span><button className="text-button" disabled={!!busy} onClick={()=>void check(receipt)}>查询审核</button><button className="text-button" onClick={()=>download(receipt,'投稿凭证-'+receipt.id+'.json')}>保存凭证</button></div>)}<p className="field-help">凭证保存在当前浏览器。清除浏览器数据后可用已下载凭证查询。</p><label>读取投稿凭证<input type="file" accept="application/json" onChange={async e=>{const source=e.target.files?.[0];if(!source)return;try{const value=JSON.parse(await source.text());if(!/^[a-f0-9-]{36}$/.test(value.id)||!/^[a-f0-9]{64}$/.test(value.receipt))throw new Error('凭证格式不正确。');saveReceipt(value);await check(value);}catch(error){setError((error as Error).message);}e.target.value='';}}/></label></details>}
    </div></aside></main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Submit/></React.StrictMode>);
