// Map labels and photos live outside the canvas. Observe both contacts at the
// document capture phase, then reserve a gesture if at least one began on the map.
export function bindMapTouchControls(canvas: HTMLCanvasElement, options: {
  enabled: () => boolean;
  travel: (steps: number) => void;
  pan?: (dx: number, dy: number) => void;
  multiTouch?: (active: boolean) => void;
  single: { start: (event: PointerEvent) => void; move: (event: PointerEvent) => void; finish: () => void };
}) {
  const surface = canvas.closest?.('.map-stage') || canvas, document = canvas.ownerDocument;
  const touches = new Map<number, { x: number; y: number; onMap: boolean }>();
  const seen = new WeakSet<Event>();
  let multi = false, locked = false, suppressClick = false;
  let previous: { distance: number; x: number; y: number } | null = null;
  const onMap = (target: EventTarget | null) => target === canvas || !!(target && surface.contains?.(target as Node));
  const mapContact = () => [...touches.values()].some(touch => touch.onMap);
  const pair = () => {
    if (touches.size !== 2) return null;
    const [a, b] = [...touches.values()];
    return { distance: Math.hypot(b.x - a.x, b.y - a.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  const lock = () => {
    if (locked || !options.enabled()) return;
    locked = true; options.multiTouch?.(true);
  };
  const consume = (event: Event) => { event.preventDefault(); event.stopPropagation(); };
  const down = (event: PointerEvent) => {
    if (!touches.size) suppressClick = false;
    if (event.pointerType !== 'touch') return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY, onMap: onMap(event.target) });
    if (touches.size >= 2 && mapContact()) {
      if (!multi) { multi = true; suppressClick = true; options.single.finish(); }
      lock();
      for (const id of touches.keys()) canvas.setPointerCapture(id);
      consume(event);
    } else if (event.target === canvas && options.enabled()) {
      options.single.start(event); canvas.setPointerCapture(event.pointerId);
    }
    previous = pair();
  };
  const move = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') return;
    const touch = touches.get(event.pointerId);
    if (!touch) return;
    touch.x = event.clientX; touch.y = event.clientY;
    if (multi) {
      consume(event); lock();
      const next = pair();
      if (options.enabled() && previous && next) {
        if (next.distance > 0 && previous.distance > 0 && next.distance !== previous.distance) options.travel(5 * Math.log(next.distance / previous.distance));
        const dx = next.x - previous.x, dy = next.y - previous.y;
        if (dx || dy) options.pan?.(dx, dy);
      }
      previous = next;
    } else if (touch.onMap && options.enabled()) options.single.move(event);
  };
  const finish = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || !touches.has(event.pointerId)) return;
    // Taking an overlay's implicit capture must not discard that contact.
    if (event.type === 'lostpointercapture' && event.target !== canvas) return;
    if (!multi) options.single.finish();
    touches.delete(event.pointerId); previous = pair();
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    // Stay in two-finger mode until both lift; the remaining finger must not
    // abruptly resume an old OrbitControls drag or activate an overlay button.
    if (!touches.size) {
      multi = false;
      if (locked) { locked = false; options.multiTouch?.(false); }
    }
  };
  const clear = () => {
    options.single.finish();
    const captured = [...touches.keys()]; touches.clear(); previous = null; multi = false; suppressClick = false;
    if (locked) { locked = false; options.multiTouch?.(false); }
    for (const id of captured) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  };
  const click = (event: MouseEvent) => { if (suppressClick && event.detail > 0) { consume(event); event.stopImmediatePropagation(); } };
  const nativeTouch = (event: TouchEvent) => {
    if (multi || event.touches.length >= 2 && [...event.touches].some(touch => onMap(touch.target))) event.preventDefault();
  };
  const nativeGesture = (event: Event) => { if (multi || mapContact() || onMap(event.target)) event.preventDefault(); };
  const capture = { capture: true, passive: false };
  const handlers = { pointerdown: down, pointermove: move, pointerup: finish, pointercancel: finish, lostpointercapture: finish };
  const bindings: [EventTarget, string, EventListener][] = [];
  const bind = (target: EventTarget | undefined, type: string, handler: EventListener) => {
    if (!target) return;
    const listener: EventListener = event => { if (seen.has(event)) return; seen.add(event); handler(event); };
    target.addEventListener(type, listener, capture); bindings.push([target, type, listener]);
  };
  for (const [type, handler] of Object.entries(handlers)) {
    bind(document, type, handler as EventListener); bind(canvas, type, handler as EventListener);
  }
  bind(document || canvas, 'click', click as EventListener);
  bind(document || canvas, 'touchstart', nativeTouch as EventListener);
  bind(document || canvas, 'touchmove', nativeTouch as EventListener);
  bind(document || surface, 'gesturestart', nativeGesture);
  bind(document || surface, 'gesturechange', nativeGesture);
  bind(document?.defaultView || undefined, 'blur', clear);
  bind(canvas, 'blur', clear);
  return () => { for (const [target, type, listener] of bindings) target.removeEventListener(type, listener, capture); clear(); };
}
