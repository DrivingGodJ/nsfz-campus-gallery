import { useEffect, useState } from 'react';

export type InputMode = 'mouse' | 'touch';
export function useInputMode() {
  const [mode, setMode] = useState<InputMode>(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 'touch' : 'mouse');
  useEffect(() => {
    const pointer = (event: PointerEvent) => setMode(event.pointerType === 'touch' || event.pointerType === 'pen' ? 'touch' : 'mouse');
    const keyboard = () => setMode('mouse');
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('keydown', keyboard, true);
    return () => { document.removeEventListener('pointerdown', pointer, true); document.removeEventListener('keydown', keyboard, true); };
  }, []);
  return mode;
}

export function mapInteractionHelp(mode: InputMode, state: 'map' | 'placing' | 'preview' | 'editing') {
  if (state === 'placing') return mode === 'touch' ? '轻触地图，标记拍摄位置' : '点击地图，标记拍摄位置';
  if (state === 'editing') return mode === 'touch' ? '单指拖动调角度 · 松手保存方向' : '左键拖动调角度 · 松手保存方向';
  if (state === 'preview') return mode === 'touch' ? '画框对应照片范围 · 点下方按钮返回地图' : '画框对应照片范围 · Esc 返回地图';
  return mode === 'touch' ? '单指环绕 · 双指缩放前后移动 · 双指拖动平移' : '左键拖动环绕 · 滚轮前进后退 · 右键拖动平移';
}
