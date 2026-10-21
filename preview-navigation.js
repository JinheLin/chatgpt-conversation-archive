/* Preview navigation is separate from the document saved as HTML or printed. */
(() => {
  "use strict";
  function init({ main, sidebar, layout }) {
    const document = main.ownerDocument, view = document.defaultView;
    const bar = document.querySelector(".reader-bar");
    let entries = [], positions = [], active = null, frame = null, dirty = true, observing = false, anchorOffset = 24, needsReveal = true;
    let resizeObserver, mutationObserver;
    function clearActive() {
      active?.link.removeAttribute("aria-current");
      active?.questionItem?.removeAttribute("data-current-question");
      active = null;
    }
    function reveal(entry) {
      const box = sidebar.getBoundingClientRect();
      const height = sidebar.clientHeight;
      // On narrow screens the directory sits above the document. Do not try to
      // bring that off-screen panel into view or move the page itself.
      if (!height || box.bottom <= 0 || box.top >= view.innerHeight) return;
      const top = box.top + sidebar.clientTop + 12, bottom = top + height - 24;
      let rect = entry.link.getBoundingClientRect();
      const question = entry.questionItem?.querySelector(":scope > a");
      if (question && question !== entry.link) {
        const parent = question.getBoundingClientRect();
        // Keep the question identifiable even if its chapter list is taller
        // than the entire sidebar. Reveal both when the pair fits.
        rect = rect.bottom - parent.top <= bottom - top
          ? { top: parent.top, bottom: rect.bottom, height: rect.bottom - parent.top } : parent;
      }
      const delta = rect.top < top || rect.height > bottom - top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0;
      if (delta) sidebar.scrollTop = Math.max(0, sidebar.scrollTop + delta);
    }
    function update() {
      frame = null;
      if (!observing || main.hidden || layout.hidden || sidebar.hidden) return;
      if (dirty) {
        positions = entries.filter(entry => !entry.target.closest("[hidden]") && entry.target.getClientRects().length)
          .map(entry => ({ entry, top: entry.target.getBoundingClientRect().top + view.scrollY }))
          .sort((a, b) => a.top - b.top);
        anchorOffset = (parseFloat(entries[0] && view.getComputedStyle(entries[0].target).scrollMarginTop) || 0) + 4;
        dirty = false;
      }
      if (!positions.length) { clearActive(); return; }
      const line = view.scrollY + Math.max(anchorOffset, (bar?.getBoundingClientRect().bottom || 0) + 24);
      let low = 0, high = positions.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (positions[middle].top <= line) low = middle + 1;
        else high = middle;
      }
      const atEnd = view.scrollY > 0 && main.getBoundingClientRect().bottom <= view.innerHeight + 2;
      const next = positions[atEnd ? positions.length - 1 : Math.max(0, low - 1)].entry;
      // A filtered-out question must not select a different visible question.
      if (next.link.closest("[hidden]")) { clearActive(); return; }
      if (next === active && !needsReveal) return;
      if (next !== active) {
        clearActive(); active = next;
        active.link.setAttribute("aria-current", "location");
        active.questionItem?.setAttribute("data-current-question", "true");
      }
      reveal(active);
      needsReveal = false;
    }
    function schedule() {
      if (frame === null && observing) frame = view.requestAnimationFrame(update);
    }
    function remeasure() { dirty = true; needsReveal = true; schedule(); }
    function watch() {
      observing = true;
      view.addEventListener("scroll", schedule, { passive: true });
      view.addEventListener("resize", remeasure);
      view.addEventListener("hashchange", schedule);
      main.addEventListener("load", remeasure, true);
      if (view.ResizeObserver) {
        resizeObserver = new view.ResizeObserver(remeasure);
        for (const node of [main, sidebar, bar]) if (node) resizeObserver.observe(node);
      }
      if (view.MutationObserver) {
        mutationObserver = new view.MutationObserver(remeasure);
        for (const node of [main, sidebar]) mutationObserver.observe(node, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"] });
      }
      remeasure();
    }
    function clear() {
      observing = false;
      if (frame !== null) view.cancelAnimationFrame(frame);
      frame = null; entries = []; positions = []; dirty = true; clearActive();
      view.removeEventListener("scroll", schedule);
      view.removeEventListener("resize", remeasure);
      view.removeEventListener("hashchange", schedule);
      main.removeEventListener("load", remeasure, true);
      resizeObserver?.disconnect(); mutationObserver?.disconnect();
      layout.hidden = true;
      sidebar.hidden = true;
      sidebar.replaceChildren();
    }
    function refresh() {
      clear();
      if (main.hidden) return;
      const toc = main.querySelector(".pdf-toc");
      if (!toc) return;
      const navigation = toc.cloneNode(true);
      navigation.id = "preview-question-index";
      navigation.className = "preview-toc";
      // The source document owns all export destinations; the preview copy must
      // not duplicate IDs if the document index gains more anchors in future.
      for (const node of navigation.querySelectorAll("[id]")) node.removeAttribute("id");
      sidebar.appendChild(navigation);
      sidebar.hidden = false;
      layout.hidden = false;
      const questions = new Map([...navigation.querySelectorAll(":scope > ol > li > a")]
        .map(link => [link.getAttribute("href").slice(1), link.parentElement]));
      entries = [...navigation.querySelectorAll("a[href^='#']")].flatMap(link => {
        const id = link.getAttribute("href").slice(1), target = document.getElementById(id);
        if (!target || !main.contains(target)) return [];
        return [{ link, target, questionItem: questions.get(link.dataset.questionId || id) }];
      });
      watch();
    }
    clear();
    return { clear, refresh };
  }
  globalThis.ChatGPTPdfPreviewNavigation = { init };
})();
