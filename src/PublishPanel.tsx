import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, LoaderCircle, UploadCloud, X } from 'lucide-react';

type Publication = { running: boolean; status: string; message: string; step?: number; runURL?: string; siteURL?: string; commit?: string };
type Plan = { added: number; updated: number; removed: number; saved: number; drafts: number; files: string[]; ahead: number; buildingChanged: boolean };
type State = { publication: Publication; plan: Plan | null; problem: string };
const stages = ['核对账户', '检查内容', '提交 GitHub', '发布网站', '确认与同步', '上线完成'];
type NativeWindow = Window & { webkit?: { messageHandlers?: { reviewApp?: { postMessage: (message: unknown) => void } } } };

export default function PublishPanel({ api, unsaved, onRunningChange }: {
  api: (route: string, method?: string, value?: unknown) => Promise<unknown>;
  unsaved: boolean; onRunningChange: (running: boolean) => void;
}) {
  const [open, setOpen] = useState(false), [state, setState] = useState<State | null>(null), [error, setError] = useState(''), [starting, setStarting] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const running = starting || state?.publication.running || false;
  const refresh = useCallback(async () => {
    try { setState(await api('release/status') as State); setError(''); }
    catch (error) { setError((error as Error).message); }
  }, [api]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    onRunningChange(running);
    (window as NativeWindow).webkit?.messageHandlers?.reviewApp?.postMessage({ type: 'publishing', value: running });
  }, [running, onRunningChange]);
  useEffect(() => {
    if (!open && !running) return;
    const interval = setInterval(() => void refresh(), running ? 1500 : 5000);
    return () => clearInterval(interval);
  }, [open, running, refresh]);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  useEffect(() => {
    const show = () => { setOpen(true); void refresh(); };
    window.addEventListener('review-app-publish', show);
    return () => window.removeEventListener('review-app-publish', show);
  }, [refresh]);
  const start = async () => {
    if (running || unsaved || state?.problem) return;
    setStarting(true); setError('');
    try { const publication = await api('release/start', 'POST', {}) as Publication; setState(value => value ? { ...value, publication } : null); }
    catch (error) { setError((error as Error).message); }
    finally { setStarting(false); void refresh(); }
  };
  const publication = state?.publication, plan = state?.plan;
  return <>
    <button className="button secondary publish-open" onClick={() => { setOpen(true); void refresh(); }}><UploadCloud size={16} />{running ? '正在上线…' : '上线'}</button>
    <dialog ref={dialog} className="publish-dialog" aria-labelledby="publish-title" onCancel={() => setOpen(false)} onClick={event => { if (event.target === dialog.current) setOpen(false); }}>
      <div className="publish-heading"><div><p className="eyebrow">附中影像 · 内容发布</p><h1 id="publish-title">{publication?.status === 'completed' && !running ? '上线完成' : '发布审核后的照片'}</h1></div><button className="icon-button" aria-label="关闭上线面板" onClick={() => setOpen(false)}><X size={20} /></button></div>
      <p className="publish-description">保存到内容库的照片会公开展示；待审核草稿和私有原片留在这台电脑。</p>
      {plan && <><div className="publish-counts"><span><strong>{plan.added}</strong>新增照片</span><span><strong>{plan.updated}</strong>资料更新</span><span><strong>{plan.removed}</strong>移出展示</span></div><p className="field-help publish-summary">内容库共 {plan.saved} 张照片 · {plan.drafts} 张草稿暂不上线{plan.buildingChanged ? ' · 包含建筑资料更新' : ''}</p></>}
      {unsaved && <p className="publish-warning">当前照片还有未保存的修改。请先关闭此面板，保存到内容库后再上线。</p>}
      {(state?.problem || error) && <p className="publish-warning" role="alert">{error || state?.problem}</p>}
      {!state && !error && <p role="status"><LoaderCircle size={15} className="spin" />正在核对本地内容…</p>}
      {(running || publication?.status === 'completed' || publication?.status === 'failed') && <div className={'publish-progress ' + publication?.status}>
        <ol>{stages.map((label, index) => <li key={label} className={(publication?.step ?? 0) > index || publication?.status === 'completed' ? 'done' : (publication?.step ?? 0) === index ? 'current' : ''}><span>{(publication?.step ?? 0) > index || publication?.status === 'completed' ? <Check size={13} /> : index + 1}</span>{label}</li>)}</ol>
        <p role={publication?.status === 'failed' ? 'alert' : 'status'}>{running && <LoaderCircle size={15} className="spin" />}{publication?.message || '正在准备上线…'}</p>
      </div>}
      <div className="publish-actions">{publication?.runURL && <a className="text-button" href={publication.runURL} target="_blank" rel="noreferrer">查看发布记录<ExternalLink size={14} /></a>}{publication?.status === 'completed' && <a className="button primary" href={publication.siteURL} target="_blank" rel="noreferrer">打开网站<ExternalLink size={15} /></a>}<button className="button primary" disabled={running || unsaved || !plan || !!state?.problem} onClick={() => void start()}>{running ? '正在上线，请等待' : publication?.status === 'failed' ? '重试上线' : plan?.files.length || plan?.ahead ? '提交并上线' : '重新发布当前版本'}</button></div>
      <p className="publish-footnote">上线需要联网。检查失败或网络中断时，已审核的内容会保留，可在这里重试。</p>
    </dialog>
  </>;
}
