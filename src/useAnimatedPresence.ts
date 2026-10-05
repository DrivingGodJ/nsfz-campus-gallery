import { useEffect, useState } from 'react';

export const PANEL_TRANSITION_MS = 320;

// Keep closing content mounted until its transition ends. Reopening cancels
// the pending removal, including rapid photo/catalog changes.
export function useAnimatedPresence(open: boolean, duration = PANEL_TRANSITION_MS, animateOnMount = false) {
  const [present, setPresent] = useState(open);
  const [visible, setVisible] = useState(open && !animateOnMount);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setPresent(open); setVisible(open); return;
    }
    let frame = 0, nextFrame = 0, timer: ReturnType<typeof setTimeout> | undefined;
    if (open) {
      setPresent(true);
      // Paint the collapsed panel first so the browser has a starting layout.
      frame = requestAnimationFrame(() => { nextFrame = requestAnimationFrame(() => setVisible(true)); });
    } else {
      setVisible(false);
      timer = setTimeout(() => setPresent(false), duration);
    }
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(nextFrame); clearTimeout(timer); };
  }, [open, duration]);
  return { present, visible };
}
