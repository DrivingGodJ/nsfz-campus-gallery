import { Vector3, type Camera, type PerspectiveCamera } from 'three';
import { bindMapTouchControls } from './map-touch-controls.ts';

// Translate the target too: orbit dolly would otherwise stop at its centre.
export function travelAlongView(camera: Camera, target: Vector3, distance: number) {
  if (!Number.isFinite(distance) || !distance) return;
  const movement = camera.getWorldDirection(new Vector3()).multiplyScalar(distance);
  camera.position.add(movement);
  target.add(movement);
  camera.updateMatrixWorld();
}

export function mapTravelStep(camera: Camera) {
  // Slow down near ground level, but always retain a positive step so the
  // camera can cross the ground and its former focal point without stopping.
  return Math.max(2, Math.min(120, Math.abs(camera.position.y) * .3));
}

export function mapGroundViewDistance(camera: Camera) {
  const direction = camera.getWorldDirection(new Vector3());
  return Math.abs(camera.position.y) / Math.max(.01, Math.abs(direction.y));
}

export function panMapView(camera: PerspectiveCamera, target: Vector3, dx: number, dy: number, viewportHeight: number) {
  camera.updateMatrixWorld();
  const scale = 2 * camera.position.distanceTo(target) * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, viewportHeight);
  const movement = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(-dx * scale)
    .add(new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(dy * scale));
  camera.position.add(movement); target.add(movement); camera.updateMatrixWorld();
}

// Wheel, trackpad pinch, touch pinch and middle-button drag all use the same
// forward/backward movement. Map overlays share touch input with the canvas.
export function bindMapTravelControls(canvas: HTMLCanvasElement, options: {
  enabled: () => boolean;
  travel: (steps: number) => void;
  pan?: (dx: number, dy: number) => void;
  multiTouch?: (active: boolean) => void;
  rotation?: {
    // True selects custom rotation; false leaves rotation to OrbitControls.
    start: () => boolean;
    look: (dx: number, dy: number) => void;
    finish: () => void;
  };
}) {
  let middle: { id: number; y: number } | null = null;
  let looking: { id: number; x: number; y: number } | null = null;
  const stopLooking = () => {
    if (!looking) return;
    looking = null;
    options.rotation?.finish();
  };
  const startRotation = (event: PointerEvent) => {
    if (options.rotation?.start()) {
      looking = { id: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    }
  };
  const surface = canvas.closest?.('.map-stage') || canvas;
  const wheel = (event: WheelEvent) => {
    // Keep normal scrolling inside the photo menu; trackpad pinch anywhere
    // over the map belongs to the map, even in a fixed photo perspective.
    if (event.ctrlKey) event.preventDefault();
    else if ((event.target as Element)?.closest?.('.photo-cluster-picker')) return;
    if (!options.enabled() || !Number.isFinite(event.deltaY)) return;
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
    options.travel(-pixels / 100);
  };
  const down = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || !options.enabled()) return;
    if (event.button === 1) {
      event.preventDefault();
      middle = { id: event.pointerId, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    } else {
      const modified = event.ctrlKey || event.metaKey || event.shiftKey;
      if (event.button === 0 && !modified || event.button === 2 && modified) startRotation(event);
    }
  };
  const move = (event: PointerEvent) => {
    if (looking?.id === event.pointerId && options.enabled()) {
      event.preventDefault();
      options.rotation?.look(event.clientX - looking.x, event.clientY - looking.y);
      looking.x = event.clientX; looking.y = event.clientY;
    }
    if (middle?.id === event.pointerId) {
      const pixels = event.clientY - middle.y;
      middle.y = event.clientY;
      if (options.enabled()) { event.preventDefault(); options.travel(pixels / 100); }
    }
  };
  const finish = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    const captured = middle?.id === event.pointerId || looking?.id === event.pointerId;
    if (looking?.id === event.pointerId) stopLooking();
    if (middle?.id === event.pointerId) middle = null;
    if (captured && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  const clear = () => {
    const captured = looking?.id;
    stopLooking();
    const pointer = middle; middle = null;
    if (pointer && canvas.hasPointerCapture(pointer.id)) canvas.releasePointerCapture(pointer.id);
    if (captured !== undefined && canvas.hasPointerCapture(captured)) canvas.releasePointerCapture(captured);
  };
  const unbindTouch = bindMapTouchControls(canvas, { ...options, single: { start: startRotation, move, finish: stopLooking } });
  const captureOptions = { capture: true };
  surface.addEventListener('wheel', wheel as EventListener, { passive: false });
  // Choose the pivot before OrbitControls starts interpreting this gesture.
  canvas.addEventListener('pointerdown', down, captureOptions);
  const mouseMove = (event: PointerEvent) => { if (event.pointerType !== 'touch') move(event); };
  canvas.addEventListener('pointermove', mouseMove);
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('lostpointercapture', finish);
  canvas.addEventListener('blur', clear);
  return () => {
    unbindTouch();
    surface.removeEventListener('wheel', wheel as EventListener);
    canvas.removeEventListener('pointerdown', down, captureOptions);
    canvas.removeEventListener('pointermove', mouseMove);
    canvas.removeEventListener('pointerup', finish);
    canvas.removeEventListener('pointercancel', finish);
    canvas.removeEventListener('lostpointercapture', finish);
    canvas.removeEventListener('blur', clear);
    clear();
  };
}
