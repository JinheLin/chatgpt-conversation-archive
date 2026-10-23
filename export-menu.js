/* Hover disclosure with click and keyboard access to the two export formats. */
(() => {
  "use strict";
  function init({ root, button, popup, items, isBusy, onOpen = () => {} }) {
    const doc = root.ownerDocument;
    let pinned = false, anchor = button;
    function show(open) {
      popup.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
      if (anchor !== button) anchor.setAttribute("aria-expanded", String(open));
    }
    function close({ restoreFocus = false } = {}) {
      pinned = false;
      show(false);
      if (restoreFocus) anchor.focus({ preventScroll: true });
      popup.removeAttribute("style");
    }
    function position() {
      if (popup.hidden || anchor === button) return;
      const rect = anchor.getBoundingClientRect(), width = popup.offsetWidth, height = popup.offsetHeight;
      const view = doc.defaultView;
      if (!anchor.isConnected || rect.height > 0 && (rect.bottom <= 0 || rect.top >= view.innerHeight)) { close(); return; }
      popup.style.position = "fixed";
      popup.style.left = Math.max(8, Math.min(rect.right - width, view.innerWidth - width - 8)) + "px";
      popup.style.right = "auto";
      popup.style.top = Math.max(8, Math.min(rect.bottom + 6, view.innerHeight - height - 8)) + "px";
    }
    function open(target = button) {
      if (isBusy() || button.disabled) return false;
      if (popup.hidden || anchor !== target) onOpen(target);
      if (anchor !== target) anchor.setAttribute("aria-expanded", "false");
      anchor = target;
      popup.removeAttribute("style");
      show(true);
      position();
      return true;
    }
    function pin() { if (!popup.hidden) pinned = true; }
    // Native select menus can temporarily report no focused DOM node and move
    // the pointer outside the page. Once settings are used, keep this panel open.
    popup.addEventListener("pointerdown", pin);
    popup.addEventListener("focusin", pin);
    root.addEventListener("mouseenter", () => { if (!pinned) open(); });
    root.addEventListener("mouseleave", () => {
      if (!pinned && !popup.contains(doc.activeElement)) close();
    });
    root.addEventListener("focusout", (event) => {
      if (event.relatedTarget && !root.contains(event.relatedTarget) && event.relatedTarget !== anchor) close();
    });
    button.addEventListener("click", () => {
      if (pinned) { close(); return; }
      if (open()) { pinned = true; items[0].focus({ preventScroll: true }); }
    });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !popup.hidden) {
        event.preventDefault();
        close({ restoreFocus: true });
      } else if (["ArrowDown", "ArrowUp"].includes(event.key) &&
          (event.target === button || items.includes(event.target) || button.contains(event.target))) {
        event.preventDefault();
        if (!open(anchor)) return;
        pinned = true;
        const index = items.indexOf(doc.activeElement);
        const next = index < 0 ? (event.key === "ArrowDown" ? 0 : items.length - 1) :
          (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next].focus({ preventScroll: true });
      } else if (!popup.hidden && ["Home", "End"].includes(event.key) && items.includes(event.target)) {
        event.preventDefault();
        items[event.key === "Home" ? 0 : items.length - 1].focus({ preventScroll: true });
      }
    });
    doc.addEventListener("pointerdown", (event) => {
      if (!root.contains(event.target)) close();
    });
    // Internal sidebar scrolling and layout reflow must not dismiss settings.
    // The fixed per-question panel follows its trigger while it remains visible.
    doc.defaultView?.addEventListener("scroll", position, true);
    doc.defaultView?.addEventListener("resize", position);
    close();
    return { close, pin, reposition: position,
      openFor(target) { if (open(target)) { pinned = true; items[0].focus({ preventScroll: true }); } }
    };
  }
  globalThis.ChatGPTPdfExportMenu = { init };
})();
