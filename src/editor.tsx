import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowUpRight, Building2, Check, Columns2, Crosshair, ImagePlus, Images, LoaderCircle, Save, Trash2, Undo2 } from 'lucide-react';
import { Brand, EmptyPhotos, Notice, PhotoMetadataView } from './components';
import { asset, buildingInfo, headingText, type BuildingOverride, type EditorState, type Photo } from './types';
import { buildingFloorText } from './building-model';
import { photoFieldOfView, viewSourceText } from './photo-view';
import { assignPhotoLocation, campusFilterLocations, photoLocationId, isAerialPhoto } from './locations';
import LocationOptions from './LocationOptions';
import PhotoPositionFields from './PhotoPositionFields';
import { PhotoPerspectiveButton } from './PhotoPerspective';
import PhotoComparison from './PhotoComparison';
import ReviewInbox from './ReviewInbox';
import type { Submission } from './submission-types';
import './styles.css';

const MapView = React.lazy(() => import('./MapView'));
const token = document.querySelector<HTMLMetaElement>('meta[name="local-editor-token"]')?.content || '';
async function api(route: string, method = 'GET', value?: unknown, file?: File) {
  const response = await fetch('/__local/' + route, { method, headers: { 'x-local-editor-token': token, ...(file ? { 'x-photo-filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' } : { 'Content-Type': 'application/json' }) }, body: file || (value ? JSON.stringify(value) : undefined) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '操作失败，请重试。');
  return data;
}
function BuildingSource({ state, id }: { state: EditorState; id: string }) {
  const building = state.map.buildings.find(b => b.id === id);
  return building?.osmId ? <a className="source-link" href={"https://www.openstreetmap.org/" + building.osmType + "/" + building.osmId} target="_blank" rel="noreferrer">查看 OSM 轮廓来源<ArrowUpRight size={14} /></a> : <p className="field-help">根据你的标注补充，轮廓与高度为示意。</p>;
}
function Editor() {
  const [state, setState] = useState<EditorState | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const selectableLocationIds = useMemo(() => state ? campusFilterLocations(state.map, state.site).map(item => item.id) : [], [state]);
  const locationId = photo ? photoLocationId(photo, state?.map) : '';
  const locationAllowed = !locationId || selectableLocationIds.includes(locationId);
  const [dirty, setDirty] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [comparing, setComparing] = useState(false);
  const exitPreview = useCallback(() => {
    setPreviewing(false);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.photo-perspective-action button')?.focus({ preventScroll: true }));
  }, []);
  const [mode, setMode] = useState<'photos' | 'buildings' | 'reviews'>(location.hash === '#review' ? 'reviews' : 'photos');
  const [, setReviewRows] = useState<Submission[]>([]);
  const [reviewReload, setReviewReload] = useState(0);
  const [reviewID, setReviewID] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [buildingDraft, setBuildingDraft] = useState<BuildingOverride | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [removed, setRemoved] = useState('');
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const initial = useRef(false);
  const refresh = async () => { const next = await api('state') as EditorState; setState(next); return next; };
  const selectPhoto = useCallback((p: Photo) => {
    setPreviewing(false); setComparing(false);
    let cached: Photo | null = null;
    try { cached = JSON.parse(localStorage.getItem('nsfz:edit:' + p.id) || 'null'); } catch {}
    setPhoto(cached ? { ...p, ...cached, id: p.id, files: p.files } : p); setDirty(!!cached); setPlacing(!p.placed); setReviewID(''); setMode('photos'); setError(''); setMessage('');
  }, []);
  useEffect(() => { if (initial.current) return; initial.current = true; refresh().then(next => { const first = next.drafts[0] || next.site.photos[0]; if (first) selectPhoto(first); if (location.hash === '#review') setMode('reviews'); }).catch(e => setError(e.message)); }, [selectPhoto]);
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  const change = (update: Partial<Photo>) => {
    if (!photo) return;
    const next = { ...photo, ...update };
    setPhoto(next); setDirty(true);
    try { localStorage.setItem('nsfz:edit:' + next.id, JSON.stringify(next)); }
    catch { setError('浏览器暂存空间不足，请及时保存到内容库。当前编辑内容仍在页面中。'); }
  };
  const importFiles = async (files: File[]) => {
    if (!files.length || busy) return;
    setError(''); setMessage('');
    const imported: Photo[] = [], failed: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setBusy('正在导入 ' + (i + 1) + ' / ' + files.length);
      try { const result = await api('import', 'POST', undefined, files[i]); imported.push(result.photo); }
      catch (e) { failed.push(files[i].name + '：' + (e as Error).message); }
    }
    await refresh(); if (imported.length) selectPhoto(imported[0]); setBusy('');
    if (failed.length) setError(failed.join('\n'));
    if (imported.length) {
      const automatic = imported.filter(p => isAerialPhoto(p) && p.placed).length;
      setMessage('已导入 ' + imported.length + ' 张照片。' + (automatic ? '其中 ' + automatic + ' 张航拍已自动定位。' : '') + '补充资料后保存到内容库。');
    }
    if (input.current) input.current.value = '';
  };
  const save = async () => {
    if (!photo || !state || busy) return;
    if (!locationAllowed) { setError('请重新选择主要建筑、校园区域或通道作为拍摄地点。'); return; }
    setBusy('正在保存'); setError(''); setMessage('');
    try {
      const draft = state.drafts.some(p => p.id === photo.id);
      const review = reviewID || state.reviewImports?.find(row => row.photoId === photo.id && !row.rejected && !row.synced)?.id;
      if (review) { await api('review/' + review + '/approve', 'POST', { photo, revision: state.site.revision }); setReviewReload(n => n + 1); setReviewID(''); }
      else if (draft) { await api('draft/' + photo.id, 'PUT', { photo }); await api('publish/' + photo.id, 'POST', { revision: state.site.revision }); }
      else await api('photo/' + photo.id, 'PUT', { photo, revision: state.site.revision });
      const next = await refresh(); setPhoto(next.site.photos.find(p => p.id === photo.id)!); setDirty(false); setPlacing(false);
      localStorage.removeItem('nsfz:edit:' + photo.id); setMessage('已保存到内容库。静态预览已更新，推送仓库后可发布。');
    } catch (e) { setError((e as Error).message); await refresh(); }
    finally { setBusy(''); }
  };
  const remove = async () => {
    if (!photo || !state || busy) return;
    setBusy('正在移除'); setError('');
    try {
      const id = photo.id;
      await api('photo/' + id, 'DELETE', { revision: state.site.revision }); localStorage.removeItem('nsfz:edit:' + id);
      const next = await refresh(); setPreviewing(false); setPhoto(null); setDirty(false); setPlacing(false); setRemoved(id); setMessage('照片已移出内容库，文件仍保留，可以恢复。');
      const first = next.drafts[0] || next.site.photos[0]; if (first) selectPhoto(first);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  };
  const undo = async () => {
    if (!state || !removed || busy) return;
    setBusy('正在恢复');
    try { await api('restore/' + removed, 'POST', { revision: state.site.revision }); const next = await refresh(); const p = [...next.drafts, ...next.site.photos].find(p => p.id === removed); if (p) selectPhoto(p); setRemoved(''); setMessage('照片已恢复。'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  const pickBuilding = (id: string) => {
    if (!state) return;
    setBuildingId(id);
    const index = state.map.buildings.findIndex(b => b.id === id), b = state.map.buildings[index];
    if (!b) return setBuildingDraft(null);
    const info = buildingInfo(b, state.site, index);
    setBuildingDraft({ name: state.site.buildingOverrides[id]?.name || b.name, floors: info.baseFloors, floorHeight: info.floorHeight, ...(b.parts?.length ? { partFloors: Object.fromEntries(info.sections.filter(part => part.id !== 'main').map(part => [part.id, part.floors])) } : {}) });
  };
  const saveBuilding = async () => {
    if (!state || !buildingDraft || !buildingId || busy) return;
    setBusy('正在保存建筑'); setError('');
    try { await api('buildings', 'PUT', { overrides: { ...state.site.buildingOverrides, [buildingId]: buildingDraft }, revision: state.site.revision }); await refresh(); setMessage('建筑资料已保存，普通照片按楼层更新显示位置。'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  const selectAssociation = (id: string) => {
    if (!photo || !state || busy || (id && !selectableLocationIds.includes(id)) || photoLocationId(photo, state.map) === id) return;
    change(assignPhotoLocation(photo, id, state.map, state.site));
  };
  const importReview = async (row: Submission) => {
    if (busy) return; setBusy('正在导入投稿原片'); setError('');
    try { const result = await api('review/' + row.id + '/import', 'POST'); await refresh(); selectPhoto(result.photo); setReviewID(row.id); setReviewReload(n => n + 1); setMessage('原片已导入。核对标注后点击“通过审核并入库”，或填写原因退回。'); }
    catch(e) { setError((e as Error).message); await refresh(); } finally { setBusy(''); }
  };
  const activeReviewID = reviewID || state?.reviewImports?.find(row => row.photoId === photo?.id && !row.rejected && !row.synced)?.id || '';
  const rejectReview = async () => {
    if (!activeReviewID || busy) return; setBusy('正在退回投稿'); setError('');
    try { await api('review/' + activeReviewID + '/reject','POST',{reason:rejectReason}); setReviewID(''); setPhoto(null); setDirty(false); setMode('reviews'); setReviewReload(n => n + 1); setMessage('投稿已退回。已导入的本地草稿保留，可在内容库查看。'); }
    catch(e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  const reviewPhoto = !!activeReviewID;
  const saveLabel = reviewPhoto ? '通过审核并入库' : '保存到内容库';
  const editingBuilding = state?.map.buildings.find(b => b.id === buildingId);
  const editingInfo = editingBuilding && state ? buildingInfo(editingBuilding, state.site) : null;
  const draft = state?.drafts.some(p => p.id === photo?.id);
  const photoView = photo && photoFieldOfView(photo);
  const imageSource = (p: Photo, type: 'thumbnail' | 'display') => state?.drafts.some(d => d.id === p.id) ? '/__local/draft-media/' + p.id + '/' + type + '.webp' : asset(p.files[type]);
  return <div className={'app editor-app' + (comparing && mode === 'photos' && photo ? ' comparing' : '')}>
    <header className="app-header"><Brand editor /><span className="local-badge">本地编辑</span><div className="header-actions"><a className="button secondary" href="./" target="_blank" rel="noreferrer">浏览预览<ArrowUpRight size={15} /></a>{photo && mode === 'photos' && <button className="button primary" onClick={save} disabled={!!busy || !locationAllowed || !photo.placed || (isAerialPhoto(photo) && !photo.altitude)}><Save size={16} />{saveLabel}</button>}</div></header>
    {error && <Notice kind="error">{error}<button className="text-button" onClick={() => setError('')}>关闭</button></Notice>}
    {message && <Notice kind="success">{message}{removed && <button className="text-button" onClick={undo} disabled={!!busy}><Undo2 size={14} />恢复照片</button>}</Notice>}
    {busy && <div className="busy-bar" role="status"><LoaderCircle size={15} className="spin" />{busy}</div>}
    {!state ? <div className="page-loading">{error ? <button className="button primary" onClick={() => refresh().catch(e => setError(e.message))}>重新连接本地编辑器</button> : '正在打开本地内容库…'}</div> :
      <main className={'editor-main' + (comparing && mode === 'photos' && photo ? ' comparing' : '')}>
        <aside className="library-panel" aria-label="本地内容库"><div className="editor-tabs"><button className={mode === 'photos' ? 'active' : ''} onClick={() => setMode('photos')}><Images size={15} />照片</button><button className={mode === 'reviews' ? 'active' : ''} onClick={() => { setMode('reviews'); setPreviewing(false); setComparing(false); setPlacing(false); }}>审核</button><button className={mode === 'buildings' ? 'active' : ''} onClick={() => { setMode('buildings'); setPreviewing(false); setPlacing(false); if (!buildingId) pickBuilding(state.map.buildings[0].id); }}><Building2 size={15} />建筑</button></div>
          {mode === 'reviews' ? <ReviewInbox api={api} onImport={row => void importReview(row)} onReject={(row,reason) => { setBusy('正在退回投稿'); setError(''); void api('review/' + row.id + '/reject','POST',{reason}).then(() => {setReviewReload(n=>n+1);setMessage('投稿已退回。');}).catch(e=>setError(e.message)).finally(()=>setBusy('')); }} onError={setError} busy={!!busy} reload={reviewReload} onRecords={setReviewRows} /> : mode === 'photos' ? <><p className="quick-import-note">你的照片快速通道：直接导入、标注并保存，无需投稿审核。</p><div className={'import-box' + (dragging ? ' drag-over' : '')} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void importFiles(Array.from(e.dataTransfer.files)); }}><ImagePlus size={24} strokeWidth={1.4} /><strong>添加校园照片</strong><span>拖入照片，或点击导入</span><button className="button primary" onClick={() => input.current?.click()} disabled={!!busy}>导入照片</button><input ref={input} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/tiff,image/heic,image/heif" multiple onChange={e => void importFiles(Array.from(e.target.files || []))} aria-label="选择校园照片文件" /><small>支持批量导入 · 单张最多 40 MB</small></div>
            <div className="library-title">内容库 <span>{state.drafts.length + state.site.photos.length}</span></div>
            {[...state.drafts, ...state.site.photos].map(p => <button className={'library-photo' + (photo?.id === p.id ? ' active' : '')} key={p.id} onClick={() => selectPhoto(p)}><img src={imageSource(p, 'thumbnail')} alt="" /><span><strong>{p.title}</strong><small>{state.drafts.some(d => d.id === p.id) ? '待标注草稿' : '已保存'}</small></span>{!state.drafts.some(d => d.id === p.id) && <Check size={13} />}</button>)}
            {state.drafts.length + state.site.photos.length === 0 && <p className="library-help">原始照片保存在本地。公开网站使用处理后的展示图和高清 JPEG。</p>}
          </> : <><p className="library-help">OSM 提供轮廓与部分层数。名称、楼层数和层高可以在这里校准。</p>{state.map.buildings.map((b, i) => <button className={'building-row' + (buildingId === b.id ? ' active' : '')} key={b.id} onClick={() => pickBuilding(b.id)}><Building2 size={15} /><span>{buildingInfo(b, state.site, i).name}<small>{buildingFloorText(buildingInfo(b, state.site, i))} · 层高 {buildingInfo(b, state.site, i).floorHeight} m</small></span></button>)}</>}
        </aside>
        <div className="editor-map"><PhotoComparison photo={comparing && mode === 'photos' ? photo : null} imageSource={photo ? imageSource(photo, 'display') : undefined}
          navigation={<button className="button secondary" onClick={() => {
            setPreviewing(false); setComparing(false);
            requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.edit-comparison-button')?.focus({ preventScroll: true }));
          }}><ArrowLeft size={15} />继续标注</button>}
          actions={photo && <><PhotoPerspectiveButton photo={photo} active={previewing} compact editor onClick={() => { if (previewing) exitPreview(); else { setPlacing(false); setPreviewing(true); } }} /><span className="comparison-hint">{previewing ? '拖动模型调整镜头，松手同步角度' : '原照片与校园模型同屏对照'}</span></>}>
          <React.Suspense fallback={<div className="map-stage map-loading">正在绘制校园地图…</div>}><MapView campus={state.map} site={state.site} photos={state.site.photos.filter(p => p.id !== photo?.id)} selectedLocation={mode === 'buildings' ? buildingId : locationId} floor={mode === 'photos' ? photo?.floor : 0} featuresSelectable={mode === 'photos'} selectableLocationIds={mode === 'photos' ? selectableLocationIds : undefined} photoPreview={comparing && mode === 'photos'} photoPerspective={previewing && mode === 'photos'} onExitPhotoPerspective={exitPreview} onPhotoOrientation={orientation => { if (!busy) change(orientation); }} placing={placing && mode === 'photos' && !busy} editPhoto={mode === 'photos' ? photo : null} onHeading={heading => { if (!busy) change({ heading }); }} onPlace={point => { if (photo && !busy) { change({ position: { ...photo.position, ...point }, placed: true }); setPlacing(false); setMessage('拍摄位置已标记，可以继续补充照片资料。'); } }} onLocation={id => { if (mode === 'buildings') { if (!busy) pickBuilding(id); } else if (photo) selectAssociation(id); }} onSelectPhoto={selectPhoto} /></React.Suspense>
          {mode === 'photos' && photo && !comparing && <button className={'button placement-button ' + (placing ? 'primary' : 'secondary')} onClick={() => { setPreviewing(false); setPlacing(!placing); }}><Crosshair size={17} />{placing ? '正在定位 · 点击地图' : photo.placed ? '重新标记拍摄位置' : '标记拍摄位置'}</button>}
        </PhotoComparison>
        </div>
        <aside className="edit-panel" aria-label={mode === 'photos' ? '照片标注' : mode === 'reviews' ? '投稿审核' : '建筑资料'}>
          {mode === 'photos' && photo ? <><div className="edit-heading"><p className="eyebrow">{draft ? '照片草稿' : '照片资料'}</p><span className={'save-status ' + (dirty ? 'unsaved' : '')}>{dirty ? '修改暂存在此浏览器' : draft ? '待保存到内容库' : '已保存'}</span></div><img className="edit-preview" src={imageSource(photo, 'display')} alt={photo.title} /><button className="button secondary edit-comparison-button" onClick={() => { setPlacing(false); setComparing(true); }}><Columns2 size={16} />照片与模型同屏</button>
            <fieldset className="edit-form" disabled={!!busy}><label>照片标题<input value={photo.title} maxLength={160} onChange={e => change({ title: e.target.value })} /></label><label>文字描述<textarea value={photo.description} rows={3} maxLength={10000} placeholder="写下这张照片的故事…" onChange={e => change({ description: e.target.value })} /></label>
              <div className="field-pair"><label>拍摄日期<input type="date" value={photo.capturedAt.slice(0, 10)} onChange={e => { const time = photo.capturedAt.split('T')[1]; change({ capturedAt: e.target.value ? e.target.value + (time ? 'T' + time : '') : '' }); }} /></label><label>拍摄时间<input type="time" step={1} disabled={!photo.capturedAt} value={photo.capturedAt.split('T')[1] || ''} onChange={e => change({ capturedAt: photo.capturedAt.slice(0, 10) + (e.target.value ? 'T' + e.target.value : '') })} /></label></div>
              <div className="form-divider">作者与版权</div><label>作者<input name="author" value={photo.author || ''} maxLength={200} placeholder="原片未提供，可留空" onChange={e => change({ author: e.target.value })} /></label><label>版权信息<textarea name="copyright" value={photo.copyright || ''} rows={2} maxLength={3000} placeholder="原片未提供，可留空" onChange={e => change({ copyright: e.target.value })} /></label><p className="field-help">自动读取原片的作者与版权元数据；没有记录时留空，不推断作者或使用许可。</p>
              <PhotoMetadataView photo={photo} editor />
              <div className="form-divider">拍摄位置</div><label>拍摄地点<select aria-label="拍摄地点" value={locationAllowed ? locationId : "legacy-location"} onChange={e => selectAssociation(e.target.value)}>{!locationAllowed && <option value="legacy-location" disabled>请重新选择地点</option>}<option value="">校园室外（未指定地点）</option><LocationOptions campus={state.map} site={state.site} /></select></label>{!locationAllowed && <p className="field-help" role="status">原来标注的小地点已停止使用，请选择主要建筑、校园区域或通道后保存。</p>}
              <PhotoPositionFields photo={photo} campus={state.map} site={state.site} onChange={change} />
              <details className="precision"><summary>精确水平位置</summary><div className="field-pair"><label>东西位置 / m<input type="number" step={.1} value={Number(photo.position.x.toFixed(1))} onChange={e => change({ position: { ...photo.position, x: Number(e.target.value) }, placed: true })} /></label><label>南北位置 / m<input type="number" step={.1} value={Number(photo.position.z.toFixed(1))} onChange={e => change({ position: { ...photo.position, z: Number(e.target.value) }, placed: true })} /></label></div></details>
              <div className="form-divider">镜头方向</div><label>水平朝向<span className="range-value">{headingText(photo.heading)}</span><input type="range" min={0} max={359} step={1} value={photo.heading} onChange={e => change({ heading: Number(e.target.value) })} /></label><p className="field-help">{previewing ? '拖动预览画面或调整滑块，都可以改变镜头朝向。' : '也可拖动地图上的方向手柄调整朝向。'}</p><label>仰俯角<span className="range-value">{photo.pitch > 0 ? '仰拍' : photo.pitch < 0 ? '俯拍' : '平拍'} · {Number(Math.abs(photo.pitch).toFixed(1))}°</span><input type="range" min={-90} max={90} step={1} value={photo.pitch} onChange={e => change({ pitch: Number(e.target.value) })} /></label>
              {photoView ? <div className="photo-view-summary" role="status"><strong>水平视角约 {photoView.horizontal.toFixed(1)}°</strong><span>{viewSourceText(photoView)}</span></div> : <p className="field-help">未读取到焦距。补充等效焦距后，地图会显示镜头视角扇形。</p>}
              <PhotoPerspectiveButton photo={photo} active={previewing} editor onClick={() => { if (previewing) exitPreview(); else { setPlacing(false); setComparing(true); setPreviewing(true); } }} />
              <details className="precision view-calibration"><summary>校准镜头视角</summary>
                {!photo.metadata?.focalLength35Mm && photo.metadata?.focalLengthMm && <label>相机画幅<select value={photo.view?.cropFactor ?? ''} onChange={e => change({ view: { ...photo.view, cropFactor: e.target.value ? Number(e.target.value) : undefined } })}><option value="">待确认（先按全画幅估算）</option><option value="1">全画幅 · 1×</option><option value="1.5">APS-C · 1.5×</option><option value="1.6">佳能 APS-C · 1.6×</option><option value="2">M4/3 · 2×</option></select></label>}
                <label>手动等效 35 mm 焦距 / mm<input type="number" min={1} max={10000} step={.1} placeholder={photo.metadata?.focalLength35Mm ? String(photo.metadata.focalLength35Mm) : '留空自动使用照片参数'} value={photo.view?.focalLength35Mm ?? ''} onChange={e => change({ view: { ...photo.view, focalLength35Mm: e.target.value ? Number(e.target.value) : undefined } })} /></label>
                <p className="field-help">焦距越短，扇形越宽。裁切照片可手动修正等效焦距；扇形只表示角度，不表示拍摄距离或遮挡范围。</p>
              </details>
              {!photo.placed && <p className="placement-help">先点击“标记拍摄位置”，再点击地图。</p>}
              <button className="button primary full-width" onClick={save} disabled={!!busy || !locationAllowed || !photo.placed || (isAerialPhoto(photo) && !photo.altitude)}><Save size={16} />{saveLabel}</button>{activeReviewID && <><label>退回原因<textarea maxLength={1000} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="可留空；投稿人能通过投稿凭证查看" /></label><button className="button secondary full-width" onClick={rejectReview}>退回这份投稿</button></>}<button className="text-button remove-button" onClick={remove} disabled={!!busy}><Trash2 size={14} />移出内容库</button>
            </fieldset>
          </> : mode === 'buildings' && buildingDraft ? <div className="edit-form building-form"><p className="eyebrow">建筑资料</p><h2>{buildingInfo(state.map.buildings.find(b => b.id === buildingId)!, state.site, state.map.buildings.findIndex(b => b.id === buildingId)).name}</h2><label>建筑名称<input value={buildingDraft.name} maxLength={100} placeholder="补充建筑名称" onChange={e => setBuildingDraft({ ...buildingDraft, name: e.target.value })} /></label><label>{editingBuilding?.parts?.length ? '主楼地上楼层数' : '地上楼层数'}<input type="number" min={1} max={50} step={1} value={buildingDraft.floors} onChange={e => setBuildingDraft({ ...buildingDraft, floors: Number(e.target.value) })} /></label>{editingBuilding?.parts?.filter(part => part.id !== 'main').map(part => <label key={part.id}>{part.name}地上楼层数<input type="number" min={1} max={50} step={1} value={buildingDraft.partFloors?.[part.id] ?? part.floors ?? buildingDraft.floors} onChange={e => setBuildingDraft({ ...buildingDraft, partFloors: { ...buildingDraft.partFloors, [part.id]: Number(e.target.value) } })} /></label>)}<label>每层层高 / m<input type="number" min={2} max={12} step={.1} value={buildingDraft.floorHeight} onChange={e => setBuildingDraft({ ...buildingDraft, floorHeight: Number(e.target.value) })} /></label><p className="field-help">{editingInfo && editingInfo.sections.length > 1 && <>当前为{buildingFloorText(editingInfo)}。主副楼分别按各自楼层数与层高计算。 </>}模型高度按楼层数 × 层高自动计算。普通照片在地图中的高度随楼层和层高计算。</p><button className="button primary" onClick={saveBuilding} disabled={!!busy}><Save size={16} />保存建筑资料</button><BuildingSource state={state} id={buildingId} /></div> : <EmptyPhotos editor />}
        </aside>
      </main>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Editor /></React.StrictMode>);
