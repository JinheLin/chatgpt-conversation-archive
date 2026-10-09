/* Hover disclosure with click and keyboard access to the two export formats. */
(() => {
  "use strict";
  function init({ root, button, popup, items, isBusy }) {
    const doc = root.ownerDocument;
    let pinned = false;
    function show(open) {
      popup.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
    }
    function close({ restoreFocus = false } = {}) {
      pinned = false;
      show(false);
      if (restoreFocus) button.focus();
    }
    function open() {
      if (isBusy() || button.disabled) return false;
      show(true);
      return true;
    }
    root.addEventListener("mouseenter", open);
    root.addEventListener("mouseleave", () => {
      if (!pinned && !popup.contains(doc.activeElement)) close();
    });
    root.addEventListener("focusout", (event) => {
      if (!root.contains(event.relatedTarget)) close();
    });
    button.addEventListener("click", () => {
      if (pinned) { close(); return; }
      if (open()) { pinned = true; items[0].focus(); }
    });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !popup.hidden) {
        event.preventDefault();
        close({ restoreFocus: true });
      } else if (["ArrowDown", "ArrowUp"].includes(event.key) &&
          (event.target === button || items.includes(event.target) || button.contains(event.target))) {
        event.preventDefault();
        if (!open()) return;
        pinned = true;
        const index = items.indexOf(doc.activeElement);
        const next = index < 0 ? (event.key === "ArrowDown" ? 0 : items.length - 1) :
          (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next].focus();
      } else if (!popup.hidden && ["Home", "End"].includes(event.key) && items.includes(event.target)) {
        event.preventDefault();
        items[event.key === "Home" ? 0 : items.length - 1].focus();
      }
    });
    doc.addEventListener("pointerdown", (event) => {
      if (!root.contains(event.target)) close();
    });
    close();
    return { close };
  }
  globalThis.ChatGPTPdfExportMenu = { init };
})();
