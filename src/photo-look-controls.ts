import type { Photo } from './types';

export type PhotoOrientation = { heading: number; pitch: number };
export type PhotoViewAdjustment = PhotoOrientation & Partial<Pick<Photo, 'position' | 'cameraHeight' | 'altitude'>>;

// Gestures update the camera directly and commit when released, so draft
// storage cannot hold up a frame while looking or nudging the shooting position.
export function bindPhotoLookControls(canvas: HTMLCanvasElement, options: {
  angles: () => PhotoOrientation;
  degreesPerPixel: () => number;
  start: () => void;
  look: (orientation: PhotoOrientation) => void;
  commit: (orientation: PhotoOrientation) => void;
  move?: (forward: number, right: number, up: number) => void;
}) {
  let pointer: { id: number; x: number; y: number; moved: boolean } | null = null;
  const movementKeys = new Set<string>();
  let positionMoved = false;
  const previousTabIndex = canvas.tabIndex, previousLabel = canvas.getAttribute('aria-label');
  const previousTouchAction = canvas.style.touchAction, previousCursor = canvas.style.cursor;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', options.move ? '照片视角，拖动调整镜头，WASD 微调位置，上下键调整高度，Shift 加快' : '照片视角，拖动或使用方向键调整镜头方向');
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'grab';
  const rotate = (horizontal: number, vertical: number) => {
    const angles = options.angles();
    options.look({ heading: ((angles.heading + horizontal) % 360 + 360) % 360,
      pitch: Math.max(-90, Math.min(90, angles.pitch + vertical)) });
  };
  const down = (event: PointerEvent) => {
    if (pointer || event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    options.start();
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
  };
  const move = (event: PointerEvent) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    event.preventDefault();
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    pointer.x = event.clientX; pointer.y = event.clientY;
    if (!dx && !dy) return;
    pointer.moved = true;
    const sensitivity = options.degreesPerPixel();
    // Grab the scene: dragging right brings scenery right and turns the gaze left.
    rotate(-dx * sensitivity, dy * sensitivity);
  };
  const finish = (event?: PointerEvent) => {
    if (!pointer || event && event.pointerId !== pointer.id) return;
    const { id, moved } = pointer;
    pointer = null;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    canvas.style.cursor = 'grab';
    if (moved) { positionMoved = false; options.commit(options.angles()); }
  };
  const movementKey = (event: KeyboardEvent) => /^Key[WASD]$/.test(event.code) ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
  const commitMovement = () => {
    movementKeys.clear();
    if (positionMoved) { positionMoved = false; options.commit(options.angles()); }
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { commitMovement(); return; }
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const movement = movementKey(event);
    if (options.move && ['w', 'a', 's', 'd', 'arrowup', 'arrowdown'].includes(movement)) {
      event.preventDefault(); options.start();
      movementKeys.add(movement); positionMoved = true;
      const step = event.shiftKey ? .5 : .1;
      options.move(movement === 'w' ? step : movement === 's' ? -step : 0,
        movement === 'd' ? step : movement === 'a' ? -step : 0,
        movement === 'arrowup' ? step : movement === 'arrowdown' ? -step : 0);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    options.start();
    const step = event.shiftKey ? 5 : 1;
    rotate(event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
      event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0);
    positionMoved = false; options.commit(options.angles());
  };
  const keyUp = (event: KeyboardEvent) => { movementKeys.delete(movementKey(event)); if (!movementKeys.size) commitMovement(); };
  const blur = () => { finish(); commitMovement(); };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('lostpointercapture', finish);
  canvas.addEventListener('keydown', key);
  canvas.addEventListener('keyup', keyUp);
  canvas.addEventListener('blur', blur);
  canvas.ownerDocument.defaultView?.addEventListener('blur', blur);
  canvas.focus({ preventScroll: true });
  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', finish);
    canvas.removeEventListener('pointercancel', finish);
    canvas.removeEventListener('lostpointercapture', finish);
    canvas.removeEventListener('keydown', key);
    canvas.removeEventListener('keyup', keyUp);
    canvas.removeEventListener('blur', blur);
    canvas.ownerDocument.defaultView?.removeEventListener('blur', blur);
    const active = pointer; pointer = null;
    if (active && canvas.hasPointerCapture(active.id)) canvas.releasePointerCapture(active.id);
    canvas.tabIndex = previousTabIndex;
    if (previousLabel === null) canvas.removeAttribute('aria-label'); else canvas.setAttribute('aria-label', previousLabel);
    canvas.style.touchAction = previousTouchAction;
    canvas.style.cursor = previousCursor;
  };
}
