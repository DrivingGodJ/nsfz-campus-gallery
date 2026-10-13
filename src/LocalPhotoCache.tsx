import { useCallback, useEffect, useState } from 'react';
import { Download, LoaderCircle, Trash2 } from 'lucide-react';

type CacheState = { configured: boolean; connected: boolean; cached: boolean; busy: boolean; operation?: string; message?: string };
const token = document.querySelector<HTMLMetaElement>('meta[name="local-editor-token"]')?.content;

export default function LocalPhotoCache({ disabled = false, onBusyChange }: { disabled?: boolean; onBusyChange?: (message: string) => void }) {
  const [state, setState] = useState<CacheState | null>(null);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch('/__local/cache/status', { cache: 'no-store' });
      if (response.ok) setState(await response.json());
    } catch { /* Keep the last state while the local service restarts. */ }
  }, []);
  useEffect(() => {
    if (!token) return;
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, pending || state?.busy ? 2000 : 10000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [refresh, pending, state?.busy]);
  const busy = pending || (state?.busy ? state.message || '正在同步照片' : '');
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const run = async (action: 'download' | 'clear') => {
    if (disabled || busy) return;
    setPending(action === 'download' ? '正在从 NAS 下载照片…' : '正在核对 NAS 并清理本地照片…');
    setError('');
    try {
      const response = await fetch('/__local/cache/' + (action === 'download' ? 'download' : 'photos'), {
        method: action === 'download' ? 'POST' : 'DELETE', headers: { 'x-local-editor-token': token || '' }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '操作未完成，请重试。');
      if (action === 'clear') {
        const native = (window as Window & { webkit?: { messageHandlers?: { reviewApp?: { postMessage: (value: unknown) => void } } } }).webkit?.messageHandlers?.reviewApp;
        if (native) { native.postMessage({ type: 'clearPhotoCache' }); return; }
      }
      location.reload();
    } catch (error) { setError((error as Error).message); }
    finally { setPending(''); await refresh(); }
  };
  if (!token || !state?.configured) return null;
  return <div className="local-photo-cache" aria-label="本地照片缓存">
    <div className="local-photo-cache-actions">
      {state.connected && <button className="button secondary" disabled={disabled || !!busy} onClick={() => void run('download')}><Download size={15} />下载照片</button>}
      {state.cached && <button className="button secondary" disabled={disabled || !!busy || !state.connected} onClick={() => void run('clear')} title="核对 NAS 备份后，仅清理本机照片和预览"><Trash2 size={15} />清理本地照片</button>}
    </div>
    <span className="local-photo-cache-status" role="status">{busy ? <><LoaderCircle size={13} className="spin" />{state.busy ? state.message : busy}</> : !state.connected ? 'NAS 未连接' : state.cached ? 'NAS 已连接 · 有本地照片' : 'NAS 已连接 · 可在线预览'}</span>
    {error && <span className="local-photo-cache-error" role="alert">{error}</span>}
  </div>;
}
