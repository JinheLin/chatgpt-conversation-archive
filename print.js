(() => {
  "use strict";
  const { t, language, localizeDocument } = globalThis.ChatGPTPdfI18n;
  localizeDocument(document);
  const main = document.getElementById("pdf-document");
  const input = document.getElementById("conversation-url");
  const status = document.getElementById("export-status");
  const startButton = document.getElementById("start-export");
  const cancelButton = document.getElementById("cancel-export");
  const actions = document.getElementById("output-actions");
  const showBackLinks = document.getElementById("show-back-links");
  function updateBackLinks() { main.dataset.showBackLinks = String(showBackLinks.checked); }
  showBackLinks.addEventListener("change", updateBackLinks);
  updateBackLinks();
  let sourceTab = null;
  let generation = 0;
  let payload = null;
  const initial = new URLSearchParams(location.search).get("source");
  if (initial) input.value = initial;

  function report(text, error = false) { status.textContent = text; status.dataset.level = error ? "error" : "info"; }
  function tabLoaded(tabId) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => done(new Error(t("loadTimeout"))), 60000);
      function listener(id, change) { if (id === tabId && change.status === "complete") done(); }
      function removed(id) { if (id === tabId) done(new Error(t("readTabClosed"))); }
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
    event?.preventDefault();
    const mine = ++generation;
    startButton.disabled = true;
    cancelButton.hidden = false;
    actions.hidden = true;
    main.hidden = true;
    payload = null;
    try {
      const target = globalThis.ChatGPTPdfSource.parseUrl(input.value.trim());
      if (sourceTab) await chrome.tabs.remove(sourceTab).catch(() => {});
      sourceTab = null;
      // Reuse only the requested conversation; never navigate or close a user's tab.
      const candidates = await chrome.tabs.query({ url: `${target.origin}/*` });
      if (mine !== generation) return;
      const existing = candidates.find((tab) => {
        try { return globalThis.ChatGPTPdfSource.parseUrl(tab.url).url === target.url; }
        catch (_) { return false; }
      });
      report(existing ? t("readExisting") :
        t("readBackground"));
      const tab = existing || await chrome.tabs.create({ url: target.url, active: false });
      if (mine !== generation) {
        if (!existing) await chrome.tabs.remove(tab.id).catch(() => {});
        return;
      }
      // sourceTab tracks only temporary tabs owned by this read operation.
      sourceTab = existing ? null : tab.id;
      await tabLoaded(tab.id);
      if (mine !== generation) return;
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["i18n.js", "conversation-source.js", "content.js"] });
      report(t("verifyFull"));
      const response = await chrome.tabs.sendMessage(tab.id, { type: "READ_FULL_CONVERSATION", source: target.url });
      if (mine !== generation) return;
      if (!response?.ok) throw new Error(response?.error || t("readFullFailed"));
      payload = response.payload;
      report(t("layoutProgress", payload.messages.length));
      const problems = globalThis.ChatGPTPdfExporter.render(payload, main);
      document.title = `${payload.title} — PDF / HTML`;
      await document.fonts.ready;
      if (mine !== generation) return;
      globalThis.ChatGPTPdfExporter.fitCode(main, document.getElementById("page-layout").value === "landscape");
      actions.hidden = false;
      report(t("readVerified", payload.messages.length, payload.completeness.questions, problems.length ? t("assetProblems", problems.length) : t("readyOutput")));
      if (!existing) {
        await chrome.tabs.remove(tab.id);
        sourceTab = null;
      }
    } catch (error) {
      if (mine === generation) report(error.message || t("readFailed"), true);
    } finally {
      if (mine === generation) {
        startButton.disabled = false;
        cancelButton.hidden = true;
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
    report(t("cancelled"));
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
      if (!payload) throw new Error(t("readFirst"));
      const css = await offlineCss();
      const exported = document.implementation.createHTMLDocument(payload.title);
      exported.documentElement.lang = language;
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
      report(t("htmlSaved"));
    } catch (error) { report(t("saveHtmlFailed", error.message), true); }
  });

  if (initial?.trim()) start();
})();
