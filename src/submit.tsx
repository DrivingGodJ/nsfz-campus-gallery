import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, Crosshair, ImagePlus, Mail, Columns2, Download, Share2 } from 'lucide-react';
import { Brand, Notice } from './components';
import { loadContent, headingText, type Campus, type Site, type Photo } from './types';
import { assignPhotoLocation, campusFilterLocations, photoLocationId, isAerialPhoto } from './locations';
import LocationOptions from './LocationOptions';
import PhotoPositionFields from './PhotoPositionFields';
import PhotoComparison from './PhotoComparison';
import PhotoImage from './PhotoImage';
import { PhotoPerspectiveButton } from './PhotoPerspective';
import { extractPhotoMetadata } from '../server/photo-metadata.mjs';
import { automaticPhotoPlacement } from '../server/photo-geolocation.mjs';
import { createPhotoPackage, submissionMailto, SUBMISSION_EMAIL, type PhotoPackage } from '../server/photo-package.mjs';
import './styles.css';
const MapView=React.lazy(()=>import('./MapView'));
const CACHE='nsfz:submission:draft';
function Submit() {
  const [content,setContent]=useState<{campus:Campus;site:Site}|null>(null),[photo,setPhoto]=useState<Photo|null>(null),[file,setFile]=useState<File|null>(null),[image,setImage]=useState('');
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(''),[placing,setPlacing]=useState(false),[comparing,setComparing]=useState(false),[perspective,setPerspective]=useState(false);
  const [pack,setPack]=useState<PhotoPackage|null>(null),[packageURL,setPackageURL]=useState(''),[downloaded,setDownloaded]=useState(false),[shareFile,setShareFile]=useState<File|null>(null);
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{void loadContent().then(setContent).catch(e=>setError(e.message));},[]);
  useEffect(()=>()=>{if(image)URL.revokeObjectURL(image);},[image]);
  useEffect(()=>()=>{if(packageURL)URL.revokeObjectURL(packageURL);},[packageURL]);
  useEffect(()=>{const handler=(e:BeforeUnloadEvent)=>{if(photo&&!downloaded){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[photo,downloaded]);
  const clearPackage=()=>{setPack(null);setPackageURL('');setShareFile(null);setDownloaded(false);setMessage('');};
  const persist=(next:Photo)=>{try{localStorage.setItem(CACHE,JSON.stringify({photo:next,filename:file?.name,size:file?.size,lastModified:file?.lastModified}));}catch{setError('浏览器暂存空间不足。请及时生成并下载照片包，当前内容仍在页面中。');}};
  const change=(update:Partial<Photo>)=>{if(!photo || busy)return;const next={...photo,...update};setPhoto(next);clearPackage();persist(next);};
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
      if(cached?.filename===source.name && cached.size===source.size && cached.lastModified===source.lastModified && cached.photo) {
        next={...next,...cached.photo,metadata,id:next.id,files:next.files,width:next.width,height:next.height};setMessage('已恢复这张照片上次暂存的标注。');
      }
      setFile(source);setPhoto(next);setImage(sourceURL);setPack(null);setPackageURL('');setShareFile(null);setDownloaded(false);setPlacing(!next.placed);setComparing(false);setPerspective(false);
      try{localStorage.setItem(CACHE,JSON.stringify({photo:next,filename:source.name,size:source.size,lastModified:source.lastModified}));}catch{}
    }catch(e){URL.revokeObjectURL(sourceURL);setError((e as Error).message);}finally{setBusy('');if(input.current)input.current.value='';}
  };
  const submit=async()=>{
    if(!photo || !file || busy)return;setError('');setMessage('');setBusy('正在生成照片包…');
    try {
      const result=await createPhotoPackage(file,photo,content?.campus);
      const attachment=new File([result.bytes],result.filename,{type:'application/zip'});
      setPack(result);setPackageURL(URL.createObjectURL(attachment));setDownloaded(false);setPlacing(false);
      let shareable=false;try{shareable=!!navigator.canShare?.({files:[attachment]});}catch{}
      setShareFile(shareable?attachment:null);
      setMessage('照片包已生成。请下载后作为邮件附件投稿；目前还没有发送邮件。');
    }catch(e){setError((e as Error).message);}finally{setBusy('');}
  };
  const share=async()=>{if(!shareFile)return;try{await navigator.share({files:[shareFile],title:'附中影像照片投稿',text:'请选择邮件，发送到 '+SUBMISSION_EMAIL});setDownloaded(true);setMessage('照片包已交给分享应用。请在邮件中确认收件人并发送。');}catch(e){if((e as Error).name!=='AbortError')setError('无法分享照片包，请下载后手动添加到邮件附件。');}};
  const location=photo&&content?photoLocationId(photo,content.campus):'',locationIds=content?campusFilterLocations(content.campus,content.site).map(l=>l.id):[];
  const allowed=!location || locationIds.includes(location);
  const canSubmit=!!photo?.placed&&!!photo.title.trim()&&allowed&&(!isAerialPhoto(photo)||!!photo.altitude);
  return <div className="app submission-app"><header className="app-header"><Brand/><span className="local-badge">投稿照片</span><div className="header-actions"><a className="button secondary" href="./"><ArrowLeft size={15}/>返回校园</a></div></header>
    {error && <Notice kind="error">{error}<button className="text-button" onClick={()=>setError('')}>关闭</button></Notice>}
    {message && <Notice kind="success">{message}</Notice>}
    {busy && <div className="busy-bar" role="status">{busy}</div>}
    <main className={'submission-main'+(comparing?' comparing':'')}><div className="submission-map"><PhotoComparison photo={comparing?photo:null} imageSource={image} navigation={<button className="button secondary" onClick={()=>{setComparing(false);setPerspective(false);}}>继续标注</button>} actions={photo && <PhotoPerspectiveButton photo={photo} active={perspective} compact editor onClick={()=>{setPerspective(!perspective);setPlacing(false);}}/>}>
      {content ? <React.Suspense fallback={<div className="page-loading">正在绘制校园…</div>}><MapView campus={content.campus} site={content.site} photos={[]} editPhoto={photo} selectedLocation={location || ''} floor={photo?.floor} selectableLocationIds={locationIds} featuresSelectable photoPreview={comparing} photoPerspective={perspective} onExitPhotoPerspective={()=>setPerspective(false)} onPhotoOrientation={change} onHeading={heading=>change({heading})} placing={placing&&!busy} onPlace={position=>{change({position,placed:true});setPlacing(false);}} onLocation={id=>{if(photo && locationIds.includes(id))change(assignPhotoLocation(photo,id,content.campus,content.site));}}/></React.Suspense>:<div className="page-loading">正在打开校园…</div>}
      {photo && !comparing && <button className={'button placement-button '+(placing?'primary':'secondary')} onClick={()=>setPlacing(!placing)} disabled={!!busy}><Crosshair size={15}/>{placing?'点击地图标记位置':photo.placed?'重新标记拍摄位置':'标记拍摄位置'}</button>}
    </PhotoComparison></div>
    <aside className="submission-form"><div className="edit-form"><h1>分享一张校园照片</h1><p className="field-help">选择照片，标记位置并体验拍摄视角，生成照片包后通过邮件投稿。原片和标注在你的设备上打包，审核通过后公开展示处理后的照片。</p>
      <button className="button primary full-width" onClick={()=>input.current?.click()} disabled={!!busy||!content}><ImagePlus size={17}/>{photo?'选择另一张照片':'选择照片'}</button><input ref={input} type="file" className="visually-hidden" accept="image/jpeg,image/png,image/webp,image/avif" onChange={e=>{if(e.target.files?.[0])void choose(e.target.files[0]);}} aria-label="选择投稿照片"/>
      <p className="field-help">JPEG / PNG / WebP / AVIF · 单张最多 40 MB。刷新后重新选择同一原片可恢复标注。</p>
      {photo && content && <><div className="photo-image-container"><PhotoImage className="submission-preview" src={image} alt={photo.title}/></div><button className="button secondary" onClick={()=>{setComparing(true);setPlacing(false);}}><Columns2 size={16}/>照片与模型同屏</button>
      <fieldset className="submission-fields" disabled={!!busy}><label>照片标题<input maxLength={160} value={photo.title} onChange={e=>change({title:e.target.value})}/></label><label>文字描述<textarea maxLength={10000} value={photo.description} onChange={e=>change({description:e.target.value})}/></label>
        <label>拍摄日期与时间<input type="datetime-local" step={1} value={photo.capturedAt.includes('T')?photo.capturedAt:photo.capturedAt?photo.capturedAt+'T00:00':''} onChange={e=>change({capturedAt:e.target.value})}/></label>
        <label>作者<input maxLength={200} value={photo.author || ''} placeholder="原片未提供，可留空" onChange={e=>change({author:e.target.value})}/></label><label>版权信息<textarea maxLength={3000} value={photo.copyright || ''} placeholder="原片未提供，可留空" onChange={e=>change({copyright:e.target.value})}/></label>
        <label>拍摄地点<select value={location || ''} onChange={e=>change(assignPhotoLocation(photo,e.target.value,content.campus,content.site))}><option value="">校园室外（未指定地点）</option><LocationOptions campus={content.campus} site={content.site}/></select></label>
        <PhotoPositionFields photo={photo} campus={content.campus} site={content.site} onChange={change}/>
        <details className="precision"><summary>精确水平位置</summary><div className="field-pair"><label>东西 / m<input type="number" step={.1} value={Number(photo.position.x.toFixed(1))} onChange={e=>change({position:{...photo.position,x:Number(e.target.value)},placed:true})}/></label><label>南北 / m<input type="number" step={.1} value={Number(photo.position.z.toFixed(1))} onChange={e=>change({position:{...photo.position,z:Number(e.target.value)},placed:true})}/></label></div></details>
        <label>水平朝向<span className="range-value">{headingText(photo.heading)}</span><input type="range" min={0} max={359} value={photo.heading} onChange={e=>change({heading:Number(e.target.value)})}/></label><label>仰俯角<span className="range-value">{photo.pitch.toFixed(1)}°</span><input type="range" min={-90} max={90} value={photo.pitch} onChange={e=>change({pitch:Number(e.target.value)})}/></label>
        <label>等效 35 mm 焦距 / mm<input type="number" min={1} max={10000} step={.1} value={photo.view?.focalLength35Mm ?? photo.metadata?.focalLength35Mm ?? ''} placeholder="原片无焦距时，可手动填写" onChange={e=>change({view:{...photo.view,focalLength35Mm:e.target.value?Number(e.target.value):undefined}})}/></label>
        <PhotoPerspectiveButton photo={photo} active={perspective} editor onClick={()=>{setPerspective(!perspective);setComparing(true);setPlacing(false);}}/>
      </fieldset>
      <p className="field-help">投稿表示你有权提供此照片，并同意审核通过后在本站展示。缺少作者或版权元数据时保持留空。</p>
      {!pack && <><button className="button primary full-width" onClick={()=>void submit()} disabled={!!busy||!canSubmit}><Download size={16}/>生成投稿照片包</button>{!canSubmit && <p className="field-help">请先填写标题、标记拍摄位置；航拍照片还需确认高度。</p>}</>}
      {pack && <section className="package-result" aria-label="邮件投稿"><strong>照片包已生成 · {(pack.bytes.length/1024/1024).toFixed(1)} MB</strong><p className="field-help">包含原片、拍摄位置、楼层、方向和照片资料。修改标注后需要重新生成。</p>
        <a className="button primary full-width" href={packageURL} download={pack.filename} onClick={()=>setDownloaded(true)}><Download size={16}/>1. 下载照片包</a>
        <a className="button secondary full-width" href={submissionMailto(pack.manifest,pack.filename)}><Mail size={16}/>2. 打开邮件投稿</a>
        <p className="field-help">收件人：<a href={'mailto:'+SUBMISSION_EMAIL}>{SUBMISSION_EMAIL}</a><br/>请手动把下载的 ZIP 包添加为附件，再发送邮件。网页无法确认邮件是否发送，审核结果由管理员邮件回复。</p>
        {shareFile && <button className="button secondary full-width" onClick={()=>void share()}><Share2 size={16}/>分享照片包到邮件</button>}
        <p className="field-help">若未打开邮件应用，请用常用邮箱发到上面的地址。附件过大时，可使用邮箱的超大附件功能。</p>
      </section>}

      </>}
    </div></aside></main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Submit/></React.StrictMode>);
