import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, Crosshair, ImagePlus, Mail, Columns2, Download, Share2, X } from 'lucide-react';
import { Brand, Notice } from './components';
import { loadContent, headingText, type Campus, type Site, type Photo } from './types';
import { assignPhotoLocation, campusFilterLocations, photoLocationId, isAerialPhoto } from './locations';
import LocationOptions from './LocationOptions';
import PhotoPositionFields from './PhotoPositionFields';
import PhotoComparison from './PhotoComparison';
import PhotoImage from './PhotoImage';
import PhotoDepthField from './PhotoDepthField';
import { validateDepthUpload } from './photo-depth-upload';
import { PhotoHalfOverlayButton, PhotoPerspectiveButton } from './PhotoPerspective';
import { extractPhotoMetadata } from '../server/photo-metadata.mjs';
import { automaticPhotoPlacement } from '../server/photo-geolocation.mjs';
import { createPhotoBatchPackage, submissionMailto, SUBMISSION_EMAIL, MAX_PACKAGE_PHOTOS, MAX_PACKAGE_ORIGINAL_BYTES, type PhotoPackage } from '../server/photo-package.mjs';
import './styles.css';
const MapView=React.lazy(()=>import('./MapView'));
const CACHE='nsfz:submission:draft';
type SubmissionEntry = { file: File; photo: Photo; image: string; depthFile?: File; depthImage?: string };
const fileKey=(file:File)=>JSON.stringify([file.name,file.size,file.lastModified]);
function Submit() {
  const [content,setContent]=useState<{campus:Campus;site:Site}|null>(null),[entries,setEntries]=useState<SubmissionEntry[]>([]),[activeID,setActiveID]=useState(''),[accepted,setAccepted]=useState(false);
  const current=entries.find(entry=>entry.photo.id===activeID),photo=current?.photo || null,image=current?.image || '';
  const entriesRef=useRef(entries);entriesRef.current=entries;
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(''),[placing,setPlacing]=useState(false),[comparing,setComparing]=useState(false),[perspective,setPerspective]=useState(false);
  const [pack,setPack]=useState<PhotoPackage|null>(null),[packageURL,setPackageURL]=useState(''),[downloaded,setDownloaded]=useState(false),[shareFile,setShareFile]=useState<File|null>(null);
  const input=useRef<HTMLInputElement>(null);
  const mapElement=useRef<HTMLDivElement>(null);
  useEffect(()=>{void loadContent().then(setContent).catch(e=>setError(e.message));},[]);
  useEffect(()=>()=>{entriesRef.current.forEach(entry=>{URL.revokeObjectURL(entry.image);if(entry.depthImage)URL.revokeObjectURL(entry.depthImage);});},[]);
  useEffect(()=>()=>{if(packageURL)URL.revokeObjectURL(packageURL);},[packageURL]);
  useEffect(()=>{const handler=(e:BeforeUnloadEvent)=>{if(entries.length&&!downloaded){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[entries.length,downloaded]);
  const clearPackage=()=>{setPack(null);setPackageURL('');setShareFile(null);setDownloaded(false);setMessage('');};
  const persist=(next:SubmissionEntry[])=>{try{localStorage.setItem(CACHE,JSON.stringify({entries:next.map(entry=>({photo:entry.photo,filename:entry.file.name,size:entry.file.size,lastModified:entry.file.lastModified}))}));}catch{setError('浏览器暂存空间不足。请及时生成并下载照片包，当前内容仍在页面中。');}};
  const change=(update:Partial<Photo>)=>{if(!photo || busy)return;const next=entries.map(entry=>entry.photo.id===photo.id?{...entry,photo:{...photo,...update}}:entry);setEntries(next);clearPackage();persist(next);};
  const [halfOverlay,setHalfOverlay]=useState(false);
  useEffect(()=>{if(!perspective)setHalfOverlay(false);},[perspective]);
  const toggleHalfOverlay=()=>{if(busy)return;setHalfOverlay(value=>!value);setPlacing(false);setComparing(true);setPerspective(true);};
  const activate=(entry:SubmissionEntry)=>{setHalfOverlay(false);setActiveID(entry.photo.id);setPlacing(!entry.photo.placed);setComparing(false);setPerspective(false);};
  const togglePerspective=()=>{
    if(busy)return;
    setPlacing(false);
    if(perspective){setPerspective(false);setHalfOverlay(false);return;}
    setComparing(true);setPerspective(true);
    requestAnimationFrame(()=>mapElement.current?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}));
  };
  const remove=(id:string)=>{if(busy)return;const next=entries.filter(entry=>entry.photo.id!==id);const removed=entries.find(entry=>entry.photo.id===id);if(removed){URL.revokeObjectURL(removed.image);if(removed.depthImage)URL.revokeObjectURL(removed.depthImage);}setEntries(next);clearPackage();persist(next);if(activeID===id){if(next[0])activate(next[0]);else{setActiveID('');setComparing(false);setPerspective(false);setPlacing(false);}}};
  const chooseDepth=async(file:File|null)=>{
    if(!current||busy)return;
    setBusy(file?'正在读取配套深度图':'正在移除深度图');setError('');
    let url:string|undefined;
    try{
      if(file){
        if(entries.reduce((total,entry)=>total+entry.file.size+(entry.photo.id===current.photo.id?0:entry.depthFile?.size||0),0)+file.size>MAX_PACKAGE_ORIGINAL_BYTES)throw new Error('原片和深度图总大小最多 100 MB。');
        url=await validateDepthUpload(file,current.photo);
      }
      const next=entries.map(entry=>entry.photo.id===current.photo.id?{...entry,depthFile:file||undefined,depthImage:url}:entry);
      setEntries(next);clearPackage();persist(next);
      if(current.depthImage)URL.revokeObjectURL(current.depthImage);
    }catch(error){if(url)URL.revokeObjectURL(url);setError((error as Error).message);}
    finally{setBusy('');}
  };
  const readPhoto=async(source:File):Promise<SubmissionEntry>=>{
    if(!source.size || source.size>40*1024*1024)throw new Error('单张照片最多 40 MB，请先缩小原片。');
    if(!['image/jpeg','image/png','image/webp','image/avif'].includes(source.type))throw new Error('网页投稿支持 JPEG、PNG、WebP、AVIF。');
    const sourceURL=URL.createObjectURL(source);
    try {
      const dimensions=await new Promise<{width:number;height:number}>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve({width:img.naturalWidth,height:img.naturalHeight});img.onerror=()=>reject(new Error('照片无法预览，请换成 JPEG 或 PNG。'));img.src=sourceURL;});
      if(dimensions.width*dimensions.height>70000000)throw new Error('照片像素过大，请缩小到 7000 万像素以内。');
      const metadata=await extractPhotoMetadata(source);
      let next:Photo={id:crypto.randomUUID(),title:source.name.replace(/\.[^.]+$/,''),description:'',capturedAt:metadata.recordedAt || '',author:metadata.author || '',copyright:metadata.copyright || '',metadata,buildingId:'',locationId:'',floor:0,...automaticPhotoPlacement(metadata,content!.campus),heading:0,pitch:0,...dimensions,downloadBytes:source.size,files:{thumbnail:'',display:'',download:''}};
      let cached;try{const draft=JSON.parse(localStorage.getItem(CACHE)||'null');cached=draft?.entries?.find((entry:{filename:string;size:number;lastModified:number})=>entry.filename===source.name&&entry.size===source.size&&entry.lastModified===source.lastModified)||draft;}catch{}
      if(cached?.filename===source.name && cached.size===source.size && cached.lastModified===source.lastModified && cached.photo) {
        next={...next,...cached.photo,metadata,id:next.id,files:next.files,width:next.width,height:next.height};
      }
      return {file:source,photo:next,image:sourceURL};
    }catch(e){URL.revokeObjectURL(sourceURL);throw e;}
  };
  const choose=async(sources:File[])=>{
    if(!content || busy || !sources.length)return;setError('');clearPackage();setBusy('正在读取照片资料');
    const next=[...entries],failed:string[]=[];let first:SubmissionEntry|undefined;
    try {
      for(const [index,source] of sources.entries()){
        setBusy('正在读取照片 '+(index+1)+' / '+sources.length);
        if(next.some(entry=>fileKey(entry.file)===fileKey(source)))continue;
        if(next.length>=MAX_PACKAGE_PHOTOS){failed.push('一个照片包最多 20 张，剩余照片未加入。');break;}
        if(next.reduce((total,entry)=>total+entry.file.size+(entry.depthFile?.size||0),0)+source.size>MAX_PACKAGE_ORIGINAL_BYTES){failed.push(source.name+'：加入后总大小超过 100 MB。');continue;}
        try{const entry=await readPhoto(source);next.push(entry);first??=entry;}catch(e){failed.push(source.name+'：'+(e as Error).message);}
      }
      setEntries(next);if(first)activate(first);persist(next);
      if(failed.length)setError(failed.join('\n'));
    }finally{setBusy('');if(input.current)input.current.value='';}
  };
  const submit=async()=>{
    if(!canSubmit || !accepted || busy)return;setError('');setMessage('');setBusy('正在生成 '+entries.length+' 张照片的投稿包…');
    try {
      const result=await createPhotoBatchPackage(entries,content?.campus);
      const attachment=new File([result.bytes],result.filename,{type:'application/zip'});
      setPack(result);setPackageURL(URL.createObjectURL(attachment));setDownloaded(false);setPlacing(false);
      let shareable=false;try{shareable=!!navigator.canShare?.({files:[attachment]});}catch{}
      setShareFile(shareable?attachment:null);
      setMessage(entries.length+' 张照片已合成一个照片包。请把 ZIP 附在一封邮件中投稿；目前还没有发送邮件。');
    }catch(e){setError((e as Error).message);}finally{setBusy('');}
  };
  const share=async()=>{if(!shareFile)return;try{await navigator.share({files:[shareFile],title:'附中影像照片投稿',text:'请选择邮件，发送到 '+SUBMISSION_EMAIL});setDownloaded(true);setMessage('照片包已交给分享应用。请在邮件中确认收件人并发送。');}catch(e){if((e as Error).name!=='AbortError')setError('无法分享照片包，请下载后手动添加到邮件附件。');}};
  const location=photo&&content?photoLocationId(photo,content.campus):'',locationIds=content?campusFilterLocations(content.campus,content.site).map(l=>l.id):[];
  const ready=(item:Photo)=>{const id=content?photoLocationId(item,content.campus):'';return !!item.placed&&!!item.title.trim()&&(!id||locationIds.includes(id))&&(!isAerialPhoto(item)||!!item.altitude);};
  const readyCount=entries.filter(entry=>ready(entry.photo)).length;
  const canSubmit=entries.length>0&&readyCount===entries.length;
  return <div className="app submission-app"><header className="app-header"><Brand/><span className="local-badge">投稿照片</span><div className="header-actions"><a className="button secondary" href="./"><ArrowLeft size={15}/>返回校园</a></div></header>
    {error && <Notice kind="error">{error}<button className="text-button" onClick={()=>setError('')}>关闭</button></Notice>}
    {message && <Notice kind="success">{message}</Notice>}
    {busy && <div className="busy-bar" role="status">{busy}</div>}
    <main className={'submission-main'+(comparing?' comparing':'')}><div className="submission-map" ref={mapElement}><PhotoComparison photo={comparing?photo:null} imageSource={image} footerActions={photo && perspective && <PhotoHalfOverlayButton photo={photo} active={halfOverlay} disabled={!!busy} onClick={toggleHalfOverlay}/>} navigation={<button className="button secondary" onClick={()=>{setComparing(false);setPerspective(false);setHalfOverlay(false);}}>继续标注</button>} actions={photo && <PhotoPerspectiveButton photo={photo} active={perspective} compact editor disabled={!!busy} onClick={togglePerspective}/>}>
      {content ? <React.Suspense fallback={<div className="page-loading">正在绘制校园…</div>}><MapView campus={content.campus} site={content.site} photos={[]} editPhoto={photo} selectedLocation={location || ''} floor={photo?.floor} selectableLocationIds={locationIds} featuresSelectable photoPreview={comparing} photoPerspective={perspective} onExitPhotoPerspective={()=>{setPerspective(false);setHalfOverlay(false);}} onPhotoOrientation={change} onHeading={heading=>change({heading})} placing={placing&&!busy} onPlace={position=>{change({position,placed:true});setPlacing(false);}} photoImageSource={image} photoDepthSource={current?.depthImage} photoOverlayMode={halfOverlay?'translucent':'off'} onLocation={id=>{if(photo && locationIds.includes(id))change(assignPhotoLocation(photo,id,content.campus,content.site));}}/></React.Suspense>:<div className="page-loading">正在打开校园…</div>}
      {photo && !comparing && <button className={'button placement-button '+(placing?'primary':'secondary')} onClick={()=>setPlacing(!placing)} disabled={!!busy}><Crosshair size={15}/>{placing?'点击地图标记位置':photo.placed?'重新标记拍摄位置':'标记拍摄位置'}</button>}
    </PhotoComparison></div>
    <aside className="submission-form">
      {photo && !comparing && <section className="submission-view-guide" aria-label="校准照片视角"><strong>投稿前，请对照原图校准拍摄角度</strong><PhotoPerspectiveButton photo={photo} active={perspective} editor disabled={!!busy} onClick={togglePerspective}/></section>}
      <div className="edit-form"><h1>分享你的校园照片</h1><p className="field-help">一次选择多张照片，逐张标记位置和拍摄视角，最后统一打包，用一封邮件投稿。原片、配套深度图与标注在你的设备上打包，审核通过后公开展示处理后的照片。</p>
      <section className="submission-guidelines" aria-labelledby="submission-guidelines-heading"><h2 id="submission-guidelines-heading">照片投稿准则</h2><ul>
        <li>优先投稿校园景观、建筑、公共空间及四季校园环境的照片。</li>
        <li>尽量避免以人物、物品或动物为主体的照片。</li>
        <li>禁止上传同学的大头照、面部特写，以及侵犯隐私权、肖像权或其他权益的照片。请勿泄露个人信息。</li>
        <li>请提交自己拍摄或已获授权的照片。所有投稿均需审核，符合准则后才会公开展示。</li>
      </ul></section>
      <button className="button primary full-width" onClick={()=>input.current?.click()} disabled={!!busy||!content||entries.length>=MAX_PACKAGE_PHOTOS}><ImagePlus size={17}/>{entries.length?'继续添加照片':'选择照片（可多选）'}</button><input ref={input} type="file" className="visually-hidden" multiple accept="image/jpeg,image/png,image/webp,image/avif" onChange={e=>void choose(Array.from(e.target.files || []))} aria-label="选择投稿照片"/>
      <p className="field-help">JPEG / PNG / WebP / AVIF · 单张最多 40 MB · 每包最多 20 张，原片与深度图合计 100 MB。刷新后重新选择原片可恢复标注，配套深度图需重新附上。</p>
      {entries.length>0 && <section className="submission-queue" aria-label="待投稿照片"><div className="submission-queue-heading"><h2>待投稿照片 · {entries.length} 张</h2><span role="status">已标注 {readyCount} / {entries.length}</span></div><p className="field-help">点击照片名称逐张标注，最后生成一个照片包。</p><div className="submission-queue-list">{entries.map((entry,index)=><div className={'submission-queue-row'+(entry.photo.id===activeID?' active':'')} key={entry.photo.id}><button className="submission-queue-select" onClick={()=>activate(entry)} disabled={!!busy} aria-pressed={entry.photo.id===activeID}><span>{index+1}. {entry.photo.title}</span><small>{ready(entry.photo)?'已标注':'待标注'} · {(entry.file.size/1024/1024).toFixed(1)} MB</small></button><button className="icon-button" aria-label={'移除照片：'+entry.photo.title} onClick={()=>remove(entry.photo.id)} disabled={!!busy}><X size={15}/></button></div>)}</div></section>}
      {photo && content && <><h2 className="submission-current-heading">正在标注第 {entries.findIndex(entry=>entry.photo.id===activeID)+1} 张照片</h2><div className="photo-image-container"><PhotoImage className="submission-preview" src={image} alt={photo.title}/></div><button className="button secondary" onClick={()=>{setComparing(true);setPlacing(false);}}><Columns2 size={16}/>照片与模型同屏</button>
      <PhotoDepthField attached={current?.depthFile?.name} disabled={!!busy} onChoose={file=>void chooseDepth(file)} onRemove={()=>void chooseDepth(null)}/><fieldset className="submission-fields" disabled={!!busy}><label>照片标题<input maxLength={160} value={photo.title} onChange={e=>change({title:e.target.value})}/></label><label>文字描述<textarea maxLength={10000} value={photo.description} onChange={e=>change({description:e.target.value})}/></label>
        <label>拍摄日期与时间<input type="datetime-local" step={1} value={photo.capturedAt.includes('T')?photo.capturedAt:photo.capturedAt?photo.capturedAt+'T00:00':''} onChange={e=>change({capturedAt:e.target.value})}/></label>
        <label>作者<input maxLength={200} value={photo.author || ''} placeholder="原片未提供，可留空" onChange={e=>change({author:e.target.value})}/></label><label>版权信息<textarea maxLength={3000} value={photo.copyright || ''} placeholder="原片未提供，可留空" onChange={e=>change({copyright:e.target.value})}/></label>
        <label>拍摄地点<select aria-label="拍摄地点" value={location || ''} onChange={e=>change(assignPhotoLocation(photo,e.target.value,content.campus,content.site))}><option value="">校园室外（未指定地点）</option><LocationOptions campus={content.campus} site={content.site}/></select></label>
        <PhotoPositionFields photo={photo} campus={content.campus} site={content.site} onChange={change}/>
        <details className="precision"><summary>精确水平位置</summary><div className="field-pair"><label>东西 / m<input type="number" step={.1} value={Number(photo.position.x.toFixed(1))} onChange={e=>change({position:{...photo.position,x:Number(e.target.value)},placed:true})}/></label><label>南北 / m<input type="number" step={.1} value={Number(photo.position.z.toFixed(1))} onChange={e=>change({position:{...photo.position,z:Number(e.target.value)},placed:true})}/></label></div></details>
        <label>水平朝向<span className="range-value">{headingText(photo.heading)}</span><input type="range" min={0} max={359} value={photo.heading} onChange={e=>change({heading:Number(e.target.value)})}/></label><label>仰俯角<span className="range-value">{photo.pitch.toFixed(1)}°</span><input type="range" min={-90} max={90} value={photo.pitch} onChange={e=>change({pitch:Number(e.target.value)})}/></label>
        <label>等效 35 mm 焦距 / mm<input type="number" min={1} max={10000} step={.1} value={photo.view?.focalLength35Mm ?? photo.metadata?.focalLength35Mm ?? ''} placeholder="原片无焦距时，可手动填写" onChange={e=>change({view:{...photo.view,focalLength35Mm:e.target.value?Number(e.target.value):undefined}})}/></label>
      </fieldset>
      <p className="field-help">缺少作者或版权元数据时保持留空。每张照片的地点、楼层和视角会独立保存。</p>
      <label className="submission-agreement"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)} disabled={!!busy}/>我已阅读投稿准则，确认这些照片符合准则且有权提供，并同意审核通过后在本站展示。</label>
      {!pack && <><button className="button primary full-width" onClick={()=>void submit()} disabled={!!busy||!canSubmit||!accepted}><Download size={16}/>生成投稿照片包（{entries.length} 张）</button>{!canSubmit && <p className="field-help">还有 {entries.length-readyCount} 张照片待标注。请逐张填写标题、标记位置；航拍照片还需确认高度。</p>}{!accepted && <p className="field-help">生成前请阅读并确认投稿准则。</p>}</>}
      {pack && <section className="package-result" aria-label="邮件投稿"><strong>{entries.length} 张照片已统一打包 · {(pack.bytes.length/1024/1024).toFixed(1)} MB</strong><p className="field-help">包含每张原片、配套深度图（如有）及独立的拍摄位置、楼层、方向和照片资料。修改标注或照片列表后需要重新生成。</p>
        <a className="button primary full-width" href={packageURL} download={pack.filename} onClick={()=>setDownloaded(true)}><Download size={16}/>1. 下载照片包</a>
        <a className="button secondary full-width" href={submissionMailto(pack.manifest,pack.filename)}><Mail size={16}/>2. 用一封邮件投稿</a>
        <p className="field-help">收件人：<a href={'mailto:'+SUBMISSION_EMAIL}>{SUBMISSION_EMAIL}</a><br/>把这一个 ZIP 包添加为附件即可，不需要每张照片单独发邮件。网页无法确认邮件是否发送，审核结果由管理员邮件回复。</p>
        {shareFile && <button className="button secondary full-width" onClick={()=>void share()}><Share2 size={16}/>分享照片包到邮件</button>}
        <p className="field-help">若未打开邮件应用，请用常用邮箱发到上面的地址。附件过大时，可使用邮箱的超大附件功能。</p>
      </section>}

      </>}
    </div></aside></main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Submit/></React.StrictMode>);
