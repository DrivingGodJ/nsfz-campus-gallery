import { Vector3, type Camera } from 'three';

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

// Wheel, trackpad pinch, touch pinch and middle-button drag all use the same
// forward/backward movement. OrbitControls still owns rotation and panning.
export function bindMapTravelControls(canvas: HTMLCanvasElement, options: {
  enabled: () => boolean;
  travel: (steps: number) => void;
}) {
  const touches = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;
  let middle: { id: number; y: number } | null = null;
  const separation = () => {
    if (touches.size !== 2) return 0;
    const [a, b] = [...touches.values()];
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  const wheel = (event: WheelEvent) => {
    if (!options.enabled() || !Number.isFinite(event.deltaY)) return;
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
    options.travel(-pixels / 100);
  };
  const down = (event: PointerEvent) => {
    if (!options.enabled()) return;
    if (event.pointerType === 'touch') {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      pinchDistance = separation();
      canvas.setPointerCapture(event.pointerId);
    } else if (event.button === 1) {
      event.preventDefault();
      middle = { id: event.pointerId, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    }
  };
  const move = (event: PointerEvent) => {
    const touch = touches.get(event.pointerId);
    if (touch) {
      touch.x = event.clientX; touch.y = event.clientY;
      const nextDistance = separation();
      if (options.enabled() && pinchDistance > 0 && nextDistance > 0) {
        event.preventDefault();
        options.travel(5 * Math.log(nextDistance / pinchDistance));
      }
      pinchDistance = nextDistance;
    } else if (middle?.id === event.pointerId) {
      const pixels = event.clientY - middle.y;
      middle.y = event.clientY;
      if (options.enabled()) { event.preventDefault(); options.travel(pixels / 100); }
    }
  };
  const finish = (event: PointerEvent) => {
    const captured = touches.has(event.pointerId) || middle?.id === event.pointerId;
    touches.delete(event.pointerId);
    pinchDistance = separation();
    if (middle?.id === event.pointerId) middle = null;
    if (captured && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  const clear = () => {
    const captured = [...touches.keys()];
    touches.clear(); pinchDistance = 0;
    const pointer = middle; middle = null;
    if (pointer && canvas.hasPointerCapture(pointer.id)) canvas.releasePointerCapture(pointer.id);
    for (const id of captured) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  };
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('lostpointercapture', finish);
  canvas.addEventListener('blur', clear);
  return () => {
    canvas.removeEventListener('wheel', wheel);
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', finish);
    canvas.removeEventListener('pointercancel', finish);
    canvas.removeEventListener('lostpointercapture', finish);
    canvas.removeEventListener('blur', clear);
    clear();
  };
}
