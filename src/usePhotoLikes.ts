import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createLikesClient, persistentVisitor } from './likes-api';
import type { PhotoLikes } from './photo-sort';
import type { Photo } from './types';

const API = import.meta.env.VITE_LIKES_API_URL || (import.meta.env.DEV ? '/api/likes' : '');

export function usePhotoLikes(photos?: Photo[]) {
  const [visitor] = useState(() => {
    try { return persistentVisitor(window.localStorage, () => crypto.randomUUID()); } catch { return ''; }
  });
  const client = useMemo(() => createLikesClient(API, visitor), [visitor]);
  const [likes, setLikes] = useState<PhotoLikes>({});
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'unconfigured'>(API ? 'loading' : 'unconfigured');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Set<string>>(new Set());
  const writing = useRef(new Set<string>());
  const abortRead = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (!API || !photos || writing.current.size || (abortRead.current && !abortRead.current.signal.aborted)) return;
    const controller = new AbortController(); abortRead.current = controller;
    setError('');
    setPhase(previous => previous === 'ready' ? previous : 'loading');
    try {
      const next = await client.read(photos.map(photo => photo.id), controller.signal);
      if (!controller.signal.aborted) { setLikes(next); setPhase('ready'); setError(''); }
    } catch (reason) {
      if (!controller.signal.aborted) { setPhase('error'); setError(reason instanceof Error ? reason.message : '点赞暂时无法加载，请重试。'); }
    } finally { if (abortRead.current === controller) abortRead.current = null; }
  }, [client, photos]);
  useEffect(() => {
    void refresh();
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { abortRead.current?.abort(); window.removeEventListener('focus', onFocus); window.removeEventListener('online', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [refresh]);
  const toggle = async (id: string) => {
    if (!visitor || !likes[id] || likes[id].available === false || writing.current.has(id) || phase !== 'ready') return;
    abortRead.current?.abort();
    writing.current.add(id); setPending(new Set(writing.current)); setError('');
    try {
      const next = await client.set(id, !likes[id].liked);
      setLikes(previous => ({ ...previous, [id]: next }));
    } catch (reason) {
      // An interrupted request may already have committed: re-read before another attempt.
      setPhase('error'); setError(reason instanceof Error ? reason.message : '未确认点赞结果，请刷新后查看。');
    } finally { writing.current.delete(id); setPending(new Set(writing.current)); }
  };
  return { likes, phase, pending, toggle, refresh,
    message: error || (!API ? '点赞服务尚未连接。' : phase === 'loading' ? '正在连接点赞服务…' : !visitor ? '浏览器无法保存点赞标识，暂时只能查看点赞数。'
      : Object.values(likes).some(value => value.available === false) ? '部分新照片正在同步点赞，其余照片可以正常点赞。请稍后刷新。' : ''),
    canLike: phase === 'ready' && !!visitor };
}
