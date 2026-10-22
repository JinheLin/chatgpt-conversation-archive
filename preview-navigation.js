/* Preview navigation is separate from the document saved as HTML or printed. */
(() => {
  "use strict";
  function init({ main, sidebar, layout, store = globalThis.ChatGPTReaderStore, report = () => {} }) {
    const document = main.ownerDocument, view = document.defaultView;
    const bar = document.querySelector(".reader-bar");
    let entries = [], positions = [], active = null, frame = null, dirty = true, observing = false, anchorOffset = 24, needsReveal = true;
    let resizeObserver, mutationObserver;
    const memory = new Map();
    let key = null, collapsed = new Set(), toggles = [], locked = false, writable = true, pending = Promise.resolve();
    function save() {
      if (!key || !writable || !store?.saveReaderState) return;
      const current = key, ids = [...collapsed];
      pending = pending.then(() => store.saveReaderState(current, { tocCollapsed: ids })).catch(error => {
        report(globalThis.ChatGPTPdfI18n.t("readerSaveFailed", error.message), true);
      });
    }
    function paintToggle({ button, list, id, number }) {
      const folded = collapsed.has(id);
      list.hidden = folded;
      button.setAttribute("aria-expanded", String(!folded));
      const label = globalThis.ChatGPTPdfI18n.t(folded ? "readerExpandTocHeadings" : "readerCollapseTocHeadings", number);
      button.setAttribute("aria-label", label); button.title = label; button.disabled = locked;
    }
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
      let next = positions[atEnd ? positions.length - 1 : Math.max(0, low - 1)].entry;
      // A filtered-out question must not select a different visible question.
      if (next.questionItem?.hidden) { clearActive(); return; }
      // A manually folded chapter list keeps its parent question selected. Reading
      // further must never unfold it or select an invisible chapter link.
      if (next.link.closest("[hidden]")) next = next.parentEntry;
      if (!next) { clearActive(); return; }
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
        resizeObserver = new view.ResizeObserver(records => {
          if (records.every(record => record.target === sidebar)) { dirty = true; schedule(); }
          else remeasure();
        });
        for (const node of [main, sidebar, bar]) if (node) resizeObserver.observe(node);
      }
      if (view.MutationObserver) {
        mutationObserver = new view.MutationObserver(records => {
          if (records.every(record => record.type === "attributes" && record.target.classList.contains("pdf-toc-headings"))) {
            dirty = true; schedule();
          } else remeasure();
        });
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
      key = null; toggles = [];
      layout.hidden = true;
      sidebar.hidden = true;
      sidebar.replaceChildren();
    }
    function refresh({ conversationKey = null, tocCollapsed: saved, writable: canSave = true } = {}) {
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
      key = conversationKey; writable = canSave;
      if (saved) memory.set(key, new Set(saved));
      if (!memory.has(key)) memory.set(key, new Set());
      collapsed = memory.get(key);
      const questionIds = new Set();
      for (const [anchor, item] of questions) {
        const list = item.querySelector(":scope > .pdf-toc-headings");
        if (!list?.querySelector("a")) continue;
        const target = document.getElementById(anchor), id = target?.dataset.messageId || anchor;
        questionIds.add(id);
        list.id = "preview-answer-sections-" + anchor;
        const button = document.createElement("button");
        button.type = "button"; button.className = "preview-headings-toggle";
        button.setAttribute("aria-controls", list.id);
        const arrow = document.createElement("span"); arrow.textContent = "▾"; arrow.setAttribute("aria-hidden", "true");
        button.append(arrow);
        const toggle = { button, list, id, number: anchor.replace(/^question-/, "") };
        button.addEventListener("click", () => {
          if (locked) return;
          if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
          paintToggle(toggle); save(); dirty = true; schedule();
        });
        item.insertBefore(button, list); toggles.push(toggle); paintToggle(toggle);
      }
      for (const id of collapsed) if (!questionIds.has(id)) collapsed.delete(id);
      entries = [...navigation.querySelectorAll("a[href^='#']")].flatMap(link => {
        const id = link.getAttribute("href").slice(1), target = document.getElementById(id);
        if (!target || !main.contains(target)) return [];
        return [{ link, target, questionItem: questions.get(link.dataset.questionId || id) }];
      });
      const byLink = new Map(entries.map(entry => [entry.link, entry]));
      for (const entry of entries) entry.parentEntry = byLink.get(entry.questionItem?.querySelector(":scope > a"));
      watch();
    }
    clear();
    return { clear, refresh, flush: () => pending,
      setLocked(value) { locked = value; for (const { button } of toggles) button.disabled = value; }
    };
  }
  globalThis.ChatGPTPdfPreviewNavigation = { init };
})();
