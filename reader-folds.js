/* Question folds persist per conversation; the saved transcript stays complete. */
(() => {
  "use strict";
  const controllers = new WeakMap();
  function clear(root) {
    for (const node of root.querySelectorAll(".reader-turn-controls, .reader-turn-summary")) node.remove();
    for (const node of root.querySelectorAll("[data-reader-folded]")) node.removeAttribute("data-reader-folded");
    for (const node of root.querySelectorAll("[data-reader-fold-body]")) {
      node.removeAttribute("id"); node.removeAttribute("data-reader-fold-body");
    }
  }
  function reveal(target) {
    for (let node = target; node; node = node.parentElement) {
      const controller = controllers.get(node);
      if (controller) return controller.reveal(target);
    }
    return false;
  }
  function init({ main, sidebar, store = globalThis.ChatGPTReaderStore, report = () => {} }) {
    if (controllers.has(main)) return controllers.get(main);
    const document = main.ownerDocument, view = document.defaultView;
    const { t } = globalThis.ChatGPTPdfI18n;
    const memory = new Map();
    let groups = [], collapsed = new Set(), locked = false, tools, key = null, writable = true;
    let pending = Promise.resolve();
    function changed() {
      main.dispatchEvent(new view.Event("reader-fold-change"));
      if (!key || !writable || !store?.saveReaderState) return;
      const current = key, ids = [...collapsed];
      pending = pending.then(() => store.saveReaderState(current, { collapsed: ids })).catch(error => {
        report(t("readerSaveFailed", error.message), true);
      });
    }
    function button(text, action) {
      const node = document.createElement("button");
      node.type = "button"; node.textContent = text; node.addEventListener("click", action);
      return node;
    }
    function paint(group) {
      const folded = collapsed.has(group.key);
      for (const node of group.members) node.dataset.readerFolded = String(folded);
      group.summary.hidden = !folded;
      group.toggle.textContent = t(folded ? "readerExpand" : "readerCollapse");
      group.toggle.setAttribute("aria-label", t(folded ? "readerExpandQuestion" : "readerCollapseQuestion", group.number));
      group.toggle.setAttribute("aria-expanded", String(!folded));
      group.toggle.disabled = locked;
    }
    function set(group, folded, persist = true) {
      if (folded) collapsed.add(group.key); else collapsed.delete(group.key);
      paint(group);
      if (persist) changed();
    }
    function setAll(folded) {
      if (locked) return;
      for (const group of groups) set(group, folded, false);
      changed();
    }
    function unload() {
      key = null; clear(main); tools?.remove(); tools = null; groups = [];
    }
    function revealTarget(target) {
      const group = groups.find(item => item.members.some(node => node === target || node.contains(target)));
      if (!group || !collapsed.has(group.key)) return false;
      set(group, false);
      return true;
    }
    function hashTarget() {
      let id;
      try { id = decodeURIComponent(view.location.hash.slice(1)); } catch (_) { return; }
      const target = id && document.getElementById(id);
      if (target && main.contains(target) && revealTarget(target)) target.scrollIntoView({ block: "start", behavior: "auto" });
    }
    function load(conversationKey, { collapsed: saved, respectHash = true, writable: canSave = true } = {}) {
      unload();
      key = conversationKey; writable = canSave;
      if (saved) memory.set(key, new Set(saved));
      if (!memory.has(key)) memory.set(key, new Set());
      collapsed = memory.get(key);
      const labels = new Map([...main.querySelectorAll(".pdf-toc > ol > li > a")].map(link => [link.getAttribute("href").slice(1), link.textContent]));
      for (const node of main.querySelectorAll(":scope > .pdf-message")) {
        if (node.classList.contains("pdf-user")) {
          const role = node.querySelector(".pdf-role"), body = node.querySelector(".pdf-message-body");
          if (!role || !body) continue;
          const group = { key: node.dataset.messageId || node.id, number: groups.length + 1, members: [node] };
          const controls = document.createElement("span"); controls.className = "reader-turn-controls";
          group.toggle = button("", () => { if (!locked) set(group, !collapsed.has(group.key)); });
          if (!body.id) { body.id = node.id + "-reader-body"; body.dataset.readerFoldBody = "true"; }
          group.toggle.setAttribute("aria-controls", body.id);
          controls.append(group.toggle); role.append(controls);
          group.summary = document.createElement("p"); group.summary.className = "reader-turn-summary";
          group.summary.textContent = labels.get(node.id) || body.textContent.replace(/\s+/g, " ").trim().slice(0, 100) || t("questionLabel", group.number);
          role.after(group.summary); groups.push(group);
        } else if (groups.length) groups.at(-1).members.push(node);
      }
      for (const group of groups) {
        const ids = [group.toggle.getAttribute("aria-controls"), ...group.members.slice(1).map(node => node.id)].filter(Boolean);
        group.toggle.setAttribute("aria-controls", ids.join(" ")); paint(group);
      }
      if (groups.length) {
        const nav = sidebar.querySelector(".preview-toc");
        if (nav) {
          tools = document.createElement("div"); tools.className = "reader-fold-tools";
          tools.append(button(t("readerCollapseAll"), () => setAll(true)), button(t("readerExpandAll"), () => setAll(false)));
          nav.querySelector("h2")?.after(tools);
          for (const control of tools.querySelectorAll("button")) control.disabled = locked;
        }
      }
      const ids = new Set(groups.map(group => group.key));
      for (const id of collapsed) if (!ids.has(id)) collapsed.delete(id);
      if (respectHash) hashTarget();
    }
    // Expand before the browser follows the anchor, including a repeated click
    // on the current hash. Modified clicks keep their normal new-tab behavior.
    function onLink(event) {
      if (event.defaultPrevented || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest("a[href^='#']");
      let id;
      try { id = link && decodeURIComponent(link.getAttribute("href").slice(1)); } catch (_) { return; }
      const target = id && document.getElementById(id);
      if (target && main.contains(target)) revealTarget(target);
    }
    sidebar.addEventListener("click", onLink, true);
    main.addEventListener("click", onLink, true);
    view.addEventListener("hashchange", hashTarget);
    const api = { load, unload, reveal: revealTarget, flush: () => pending,
      setLocked(value) {
        locked = value;
        for (const group of groups) group.toggle.disabled = value;
        for (const control of tools?.querySelectorAll("button") || []) control.disabled = value;
      } };
    controllers.set(main, api);
    return api;
  }
  globalThis.ChatGPTReaderFolds = { init, clear, reveal };
})();
