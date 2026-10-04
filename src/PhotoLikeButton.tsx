import { Heart } from 'lucide-react';
import type { PhotoLike } from './photo-sort';

export default function PhotoLikeButton({ value, pending, disabled, message, onClick }: {
  value?: PhotoLike; pending: boolean; disabled: boolean; message?: string; onClick: () => void;
}) {
  return <button type="button" className={'button secondary photo-like-button' + (value?.liked ? ' liked' : '')}
    aria-pressed={!!value?.liked} aria-busy={pending} aria-label={value?.liked ? '取消点赞' : '点赞照片'}
    disabled={disabled || pending} title={message || '同一浏览器每张照片可点一个赞，再次点击可取消'} onClick={onClick}>
    <Heart size={17} aria-hidden="true" fill={value?.liked ? 'currentColor' : 'none'} />
    <span>{pending ? '保存中' : value?.liked ? '已点赞' : '点赞'}</span><span className="like-count" aria-live="polite">{value?.count ?? '—'}</span>
  </button>;
}
