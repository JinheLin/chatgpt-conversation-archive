(() => {
  "use strict";
  const main = document.getElementById("pdf-document");
  const input = document.getElementById("conversation-url");
  const status = document.getElementById("export-status");
  const startButton = document.getElementById("start-export");
  const cancelButton = document.getElementById("cancel-export");
  const actions = document.getElementById("output-actions");
  let sourceTab = null;
  let generation = 0;
  let payload = null;
  let managerTab;
  const managerReady = chrome.tabs.getCurrent().then((tab) => { managerTab = tab.id; });
  const initial = new URLSearchParams(location.search).get("source");
  if (initial) input.value = initial;

  function report(text, error = false) { status.textContent = text; status.dataset.level = error ? "error" : "info"; }
  function tabLoaded(tabId) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => done(new Error("页面加载超时，请检查登录状态后重试。")), 60000);
      function listener(id, change) { if (id === tabId && change.status === "complete") done(); }
      function removed(id) { if (id === tabId) done(new Error("读取窗口已关闭。")); }
      function done(error) {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.tabs.onRemoved.removeListener(removed);
        error ? reject(error) : resolve();
      }
      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.onRemoved.addListener(removed);
      chrome.tabs.get(tabId).then((tab) => { if (tab.status === "complete") done(); }, done);
    });
  }
  async function start(event) {
    event.preventDefault();
    const mine = ++generation;
    startButton.disabled = true;
    cancelButton.hidden = false;
    actions.hidden = true;
    main.hidden = true;
    payload = null;
    try {
      const target = globalThis.ChatGPTPdfSource.parseUrl(input.value.trim());
      await managerReady;
      if (mine !== generation) return;
      if (sourceTab) await chrome.tabs.remove(sourceTab).catch(() => {});
      sourceTab = null;
      report("正在打开对话。将使用此 Chrome 账号的登录状态读取完整消息链…");
      const tab = await chrome.tabs.create({ url: target.url, active: true });
      if (mine !== generation) {
        await chrome.tabs.remove(tab.id).catch(() => {});
        return;
      }
      sourceTab = tab.id;
      await tabLoaded(tab.id);
      if (mine !== generation) return;
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["style.css"] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["dom-adapter.js", "conversation-source.js", "content.js"] });
      report("正在读取并校验完整对话；不依赖页面是否滚动或已加载旧消息…");
      const response = await chrome.tabs.sendMessage(tab.id, { type: "READ_FULL_CONVERSATION" });
      if (mine !== generation) return;
      if (!response?.ok) throw new Error(response?.error || "无法读取完整对话。");
      payload = response.payload;
      report(`已读取 ${payload.messages.length} 条消息。正在排版并创建问题目录…`);
      const problems = globalThis.ChatGPTPdfExporter.render(payload, main);
      document.title = `${payload.title} — PDF / HTML`;
      await document.fonts.ready;
      if (mine !== generation) return;
      globalThis.ChatGPTPdfExporter.fitCode(main, document.getElementById("page-layout").value === "landscape");
      actions.hidden = false;
      report(`完整消息链及渲染数量校验通过：${payload.messages.length} 条消息，${payload.completeness.questions} 个问题。${problems.length ? `另有 ${problems.length} 个附件无法完整显示，详见正文标注。` : "可保存 HTML 或 PDF。"}`);
      await chrome.tabs.remove(tab.id);
      sourceTab = null;
    } catch (error) {
      if (mine === generation) report(error.message || "读取失败。", true);
    } finally {
      if (mine === generation) {
        startButton.disabled = false;
        cancelButton.hidden = true;
        if (managerTab) await chrome.tabs.update(managerTab, { active: true }).catch(() => {});
      }
    }
  }
  document.getElementById("export-form").addEventListener("submit", start);
  cancelButton.addEventListener("click", async () => {
    generation++;
    if (sourceTab) await chrome.tabs.remove(sourceTab).catch(() => {});
    sourceTab = null;
    startButton.disabled = false;
    cancelButton.hidden = true;
    report("已取消读取。");
  });
  document.getElementById("page-layout").addEventListener("change", (event) => {
    document.getElementById("page-direction").textContent = `@page { size: A4 ${event.target.value}; }`;
    main.dataset.landscape = String(event.target.value === "landscape");
    globalThis.ChatGPTPdfExporter.fitCode(main, event.target.value === "landscape");
  });
  document.getElementById("print-again").addEventListener("click", async () => {
    await document.fonts.ready;
    window.print();
  });

  let cachedCss;
  async function offlineCss() {
    if (cachedCss) return cachedCss;
    const css = await (await fetch("style.css")).text();
    let mathCss = await (await fetch("vendor/katex.min.css")).text();
    const fonts = [...new Set([...mathCss.matchAll(/url\((fonts\/[^)]+)\)/g)].map((match) => match[1]))];
    const fontData = await Promise.all(fonts.map(async (path) => {
      const blob = await (await fetch(`vendor/${path}`)).blob();
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
      });
      return [path, data];
    }));
    for (const [path, data] of fontData) mathCss = mathCss.split(`url(${path})`).join(`url(${data})`);
    cachedCss = css + "\n" + mathCss;
    return cachedCss;
  }
  document.getElementById("save-html").addEventListener("click", async () => {
    try {
      if (!payload) throw new Error("请先读取完整对话。");
      const css = await offlineCss();
      const exported = document.implementation.createHTMLDocument(payload.title);
      exported.documentElement.lang = "zh-CN";
      const charset = exported.createElement("meta"); charset.setAttribute("charset", "utf-8"); exported.head.prepend(charset);
      const csp = exported.createElement("meta"); csp.httpEquiv = "Content-Security-Policy";
      csp.content = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'none'";
      exported.head.appendChild(csp);
      const style = exported.createElement("style"); style.textContent = css + "\n" + document.getElementById("page-direction").textContent;
      exported.head.appendChild(style);
      exported.body.className = "pdf-print-page pdf-offline";
      exported.body.appendChild(main.cloneNode(true));
      const url = URL.createObjectURL(new Blob(["<!doctype html>\n" + exported.documentElement.outerHTML], { type: "text/html;charset=utf-8" }));
      const a = document.createElement("a"); a.href = url; a.download = `${payload.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120)}.html`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      report("本地 HTML 已生成，包含问题目录、样式及公式字体。请查看 Chrome 下载记录。");
    } catch (error) { report(`保存 HTML 失败：${error.message}`, true); }
  });
})();
