/* This bridge runs in Chrome's isolated content-script world. */
(() => {
  "use strict";
  globalThis.ChatGPTPdfContentController?.destroy();
  const BUTTON_ID = "chatgpt-pdf-export-btn";
  const STATUS_ID = "chatgpt-pdf-export-status";
  document.getElementById(BUTTON_ID)?.remove();
  document.getElementById(STATUS_ID)?.remove();
  let queued = false;
  let destroyed = false;

  function status(text, error = false) {
    if (destroyed || !document.body) return;
    let node = document.getElementById(STATUS_ID);
    if (!node) {
      node = document.createElement("div");
      node.id = STATUS_ID;
      node.setAttribute("role", "status");
      document.body.appendChild(node);
    }
    node.dataset.level = error ? "error" : "info";
    node.textContent = text;
  }
  async function open() {
    try {
      // ChatGPT navigates without reloading; sender.url can still be the initial homepage.
      const response = await chrome.runtime.sendMessage({ type: "OPEN_EXPORT_PAGE", source: location.href });
      if (!response?.ok) throw new Error(response?.error || "无法打开导出页。");
    } catch (_) { status("请刷新此页面后再点击，或使用 Chrome 工具栏的扩展图标。", true); }
  }
  function update() {
    queued = false;
    if (destroyed || !document.body) return;
    if (!globalThis.ChatGPTPdfDomAdapter.isConversationPage() && !/^\/share\//.test(location.pathname)) {
      document.getElementById(BUTTON_ID)?.remove();
      return;
    }
    if (document.getElementById(BUTTON_ID)) return;
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "Export PDF / HTML";
    button.addEventListener("click", open);
    document.body.appendChild(button);
  }
  function schedule() { if (!queued) { queued = true; requestAnimationFrame(update); } }
  function onMessage(message, sender, respond) {
    if (sender.id !== chrome.runtime.id || message?.type !== "READ_FULL_CONVERSATION") return false;
    status("正在读取完整对话；此窗口只用于本地导出…");
    globalThis.ChatGPTPdfSource.read(location.href).then((payload) => {
      status(`完整消息链校验通过：${payload.messages.length} 条消息。`);
      respond({ ok: true, payload });
    }).catch((error) => { status(error.message, true); respond({ ok: false, error: error.message }); });
    return true;
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  chrome.runtime.onMessage.addListener(onMessage);
  globalThis.ChatGPTPdfContentController = {
    destroy() {
      destroyed = true;
      observer.disconnect();
      try { chrome.runtime.onMessage.removeListener(onMessage); } catch (_) { /* extension reloaded */ }
      document.getElementById(BUTTON_ID)?.remove();
      document.getElementById(STATUS_ID)?.remove();
    }
  };
  update();
})();
