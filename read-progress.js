/* Interpolate reported progress without inventing completion during network waits. */
(() => {
  "use strict";
  function init({ bar, fill, count, reducedMotion = false }) {
    let shown = 0, target = 0, frame = null;
    const raf = globalThis.requestAnimationFrame?.bind(globalThis);
    const caf = globalThis.cancelAnimationFrame?.bind(globalThis);
    bar.max = 100;
    function paint(value) {
      shown = value;
      fill.style.transform = `scaleX(${value / 100})`;
      count.textContent = `${Math.floor(value)}%`;
    }
    function stop() {
      if (frame !== null) caf?.(frame);
      frame = null;
    }
    function reset() {
      stop(); target = 0;
      bar.value = 0;
      paint(0);
    }
    function set(value) {
      target = Math.max(target, Math.min(100, value));
      bar.value = target; // Accessible progress reflects the confirmed milestone.
      if (reducedMotion || !raf || target === 100) { stop(); paint(target); return; }
      if (frame !== null || shown === target) return;
      let previous;
      function tick(now) {
        frame = null;
        const elapsed = previous === undefined ? 16 : Math.min(now - previous, 64);
        previous = now;
        const next = shown + (target - shown) * (1 - Math.exp(-elapsed / 130));
        paint(target - next < 0.15 ? target : next);
        if (shown < target) frame = raf(tick);
      }
      frame = raf(tick);
    }
    reset();
    return { set, reset, stop };
  }
  globalThis.ChatGPTPdfReadProgress = { init };
})();
