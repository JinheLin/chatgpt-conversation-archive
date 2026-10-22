/* Single-question exports are derived in memory; local snapshots remain complete. */
(() => {
  "use strict";
  function select(payload, messageId) {
    const start = payload.messages.findIndex(message => message.id === messageId && message.role === "user");
    if (start < 0) throw new Error(globalThis.ChatGPTPdfI18n.t("questionExportMissing"));
    let end = start + 1;
    while (end < payload.messages.length && payload.messages[end].role !== "user") end++;
    const messages = payload.messages.slice(start, end);
    const number = payload.messages.slice(0, start + 1).filter(message => message.role === "user").length;
    return { number, payload: { ...payload,
      title: globalThis.ChatGPTPdfI18n.t("questionExportTitle", payload.title, number), messages,
      completeness: { verified: true, count: messages.length, questions: 1,
        firstMessageId: messages[0].id, lastMessageId: messages.at(-1).id }
    } };
  }
  function clear(root) {
    for (const node of root.querySelectorAll(".reader-question-export")) node.remove();
  }
  // The reading document stays mounted. Distinct IDs prevent its anchors from
  // stealing PDF destinations from the isolated print document.
  function prefixIds(root) {
    const ids = new Map();
    for (const node of root.querySelectorAll("[id]")) { ids.set(node.id, "excerpt-" + node.id); node.id = "excerpt-" + node.id; }
    for (const node of root.querySelectorAll("[href], [data-question-id], [aria-labelledby], [aria-describedby], [aria-controls]")) {
      const href = node.getAttribute("href");
      if (href?.startsWith("#") && ids.has(href.slice(1))) node.setAttribute("href", "#" + ids.get(href.slice(1)));
      if (ids.has(node.dataset.questionId)) node.dataset.questionId = ids.get(node.dataset.questionId);
      for (const name of ["aria-labelledby", "aria-describedby", "aria-controls"]) {
        if (node.hasAttribute(name)) node.setAttribute(name, node.getAttribute(name).split(/\s+/).map(id => ids.get(id) || id).join(" "));
      }
    }
  }
  async function prepare(payload, layout) {
    const root = document.createElement("main"); root.id = "pdf-excerpt"; root.className = "pdf-document";
    root.dataset.pageLayout = layout;
    root.dataset.landscape = String(globalThis.ChatGPTPageLayout.resolve(layout).landscape);
    root.setAttribute("aria-hidden", "true"); root.inert = true;
    document.body.append(root);
    const dispose = () => { root.remove(); delete document.body.dataset.exportExcerpt; };
    try {
      await globalThis.ChatGPTPdfExporter.render(payload, root);
      const { t, formatTimestamp } = globalThis.ChatGPTPdfI18n;
      root.querySelector(".pdf-meta").textContent = t("questionExportMeta", payload.messages.length, formatTimestamp(payload.capturedAt));
      prefixIds(root);
      await document.fonts.ready;
      await Promise.all([...root.querySelectorAll("img")].map(image => image.decode()));
      await globalThis.ChatGPTPdfExporter.fitCode(root, layout);
      return { root, dispose, print() {
        root.inert = false; root.removeAttribute("aria-hidden"); document.body.dataset.exportExcerpt = "true";
      } };
    } catch (error) { dispose(); throw error; }
  }
  function init({ main, scope, menu, isBusy }) {
    const document = main.ownerDocument, { t } = globalThis.ChatGPTPdfI18n;
    function unload() {
      clear(main); scope.replaceChildren(new Option(t("exportAllConversation"), ""));
    }
    function refresh() {
      unload();
      const labels = new Map([...main.querySelectorAll(".pdf-toc > ol > li > a")].map(link => [link.hash.slice(1), link.textContent]));
      for (const [index, section] of [...main.querySelectorAll(":scope > .pdf-user")].entries()) {
        const id = section.dataset.messageId;
        scope.append(new Option(t("questionLabel", index + 1) + " · " + labels.get(section.id), id));
        const button = document.createElement("button"); button.type = "button"; button.className = "reader-question-export";
        button.textContent = t("exportThisQuestion"); button.dataset.questionId = id;
        button.setAttribute("aria-label", t("exportQuestionLabel", index + 1));
        button.setAttribute("aria-haspopup", "menu"); button.setAttribute("aria-controls", "export-formats");
        button.setAttribute("aria-expanded", "false"); button.disabled = isBusy();
        button.addEventListener("click", () => { if (!isBusy()) { scope.value = id; menu.openFor(button); } });
        section.querySelector(".pdf-role")?.append(button);
      }
    }
    return { refresh, unload, setLocked(value) { for (const button of main.querySelectorAll(".reader-question-export")) button.disabled = value; } };
  }
  globalThis.ChatGPTQuestionExport = { select, clear, prepare, init };
})();
