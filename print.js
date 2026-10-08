(async () => {
  "use strict";
  // Preserve the entry URL even if localization or an output feature fails.
  const input = document.getElementById("conversation-url");
  const initial = new URLSearchParams(location.search).get("source");
  if (initial) input.value = initial;
  const { t, language, localizeDocument, loadCatalog } = globalThis.ChatGPTPdfI18n;
  await loadCatalog();
  localizeDocument(document);
  const main = document.getElementById("pdf-document");
  const status = document.getElementById("export-status");
  const readProgress = document.getElementById("read-progress");
  const progressLabel = document.getElementById("read-progress-label");
  const progressCount = document.getElementById("read-progress-count");
  const progressBar = document.getElementById("read-progress-bar");
  const startButton = document.getElementById("start-export");
  const cancelButton = document.getElementById("cancel-export");
  const actions = document.getElementById("output-actions");
  const showBackLinks = document.getElementById("show-back-links");
  let outputBusy = false;
  const outputControls = [input, startButton, showBackLinks,
    ...["save-html", "save-pdf", "print-again", "add-pdf-outline", "page-layout"].map((id) => document.getElementById(id))];
  function setOutputBusy(value) {
    outputBusy = value;
    for (const control of outputControls) control.disabled = value;
  }
  function updateBackLinks() { main.dataset.showBackLinks = String(showBackLinks.checked); }
  showBackLinks.addEventListener("change", updateBackLinks);
  updateBackLinks();
  let sourceTab = null;
  let generation = 0;
  let payload = null;
  let activeRead = null;

  function report(text, error = false) {
    readProgress.hidden = true;
    status.hidden = false;
    status.textContent = text;
    status.dataset.level = error ? "error" : "info";
  }
  const progressLabels = { connect: "progressConnect", session: "progressSession", conversation: "progressConversation",
    verify: "progressVerify", assets: "progressAssets", layout: "progressLayout" };
  function showReadProgress({ stage, completed, total }) {
    if (!Object.hasOwn(progressLabels, stage)) return;
    progressLabel.textContent = t(progressLabels[stage]);
    progressCount.textContent = "";
    progressBar.removeAttribute("value");
    if (stage === "assets" && Number.isSafeInteger(total) && total > 0 &&
        Number.isSafeInteger(completed) && completed >= 0 && completed <= total) {
      progressBar.max = total;
      progressBar.value = completed;
      progressCount.textContent = `${completed} / ${total}`;
    }
    status.hidden = true;
    readProgress.hidden = false;
  }
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || sender.tab?.id !== activeRead?.tabId ||
        !activeRead || activeRead.generation !== generation || message?.type !== "READ_PROGRESS" ||
        message.readId !== activeRead.id) return;
    if (message.progress && typeof message.progress === "object") showReadProgress(message.progress);
  });
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
    if (outputBusy) return;
    const mine = ++generation;
    startButton.disabled = true;
    cancelButton.hidden = false;
    actions.hidden = true;
    main.hidden = true;
    payload = null;
    activeRead = null;
    try {
      const target = globalThis.ChatGPTPdfSource.parseUrl(input.value.trim());
      showReadProgress({ stage: "connect" });
      if (sourceTab) await chrome.tabs.remove(sourceTab).catch(() => {});
      sourceTab = null;
      // Reuse only the requested conversation; never navigate or close a user's tab.
      const candidates = await chrome.tabs.query({ url: `${target.origin}/*` });
      if (mine !== generation) return;
      const existing = candidates.find((tab) => {
        try { return globalThis.ChatGPTPdfSource.parseUrl(tab.url).url === target.url; }
        catch (_) { return false; }
      });
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
      if (mine !== generation) return;
      activeRead = { id: crypto.randomUUID(), tabId: tab.id, generation: mine };
      showReadProgress({ stage: "conversation" });
      const response = await chrome.tabs.sendMessage(tab.id, { type: "READ_FULL_CONVERSATION", source: target.url, readId: activeRead.id });
      if (mine !== generation) return;
      activeRead = null;
      if (!response?.ok) throw new Error(response?.error || t("readFullFailed"));
      payload = response.payload;
      showReadProgress({ stage: "layout" });
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
        activeRead = null;
        startButton.disabled = false;
        cancelButton.hidden = true;
      }
    }
  }
  document.getElementById("export-form").addEventListener("submit", start);
  cancelButton.addEventListener("click", async () => {
    generation++;
    activeRead = null;
    report(t("cancelled"));
    if (sourceTab) await chrome.tabs.remove(sourceTab).catch(() => {});
    sourceTab = null;
    startButton.disabled = false;
    cancelButton.hidden = true;
  });
  document.getElementById("page-layout").addEventListener("change", (event) => {
    document.getElementById("page-direction").textContent = `@page { size: A4 ${event.target.value}; }`;
    main.dataset.landscape = String(event.target.value === "landscape");
    globalThis.ChatGPTPdfExporter.fitCode(main, event.target.value === "landscape");
  });
  document.getElementById("print-again").addEventListener("click", async () => {
    if (outputBusy) return;
    await document.fonts.ready;
    window.print();
  });

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function pdfMetadata() {
    if (!payload) throw new Error(t("readFirst"));
    return {
      sourceUrl: payload.sourceUrl,
      questions: [...main.querySelectorAll(".pdf-toc li a")].map((link) => ({
        id: link.getAttribute("href").slice(1), title: link.textContent
      }))
    };
  }
  document.getElementById("save-pdf").addEventListener("click", async () => {
    if (outputBusy) return;
    setOutputBusy(true);
    try {
      const metadata = pdfMetadata();
      report(t("directPdfProgress"));
      await document.fonts.ready;
      await Promise.all([...main.querySelectorAll("img")].map((image) => image.decode()));
      const landscape = document.getElementById("page-layout").value === "landscape";
      globalThis.ChatGPTPdfExporter.fitCode(main, landscape);
      const bytes = await globalThis.ChatGPTPdfCapture.capture({ landscape });
      report(t("pdfOutlineProgress"));
      const result = await globalThis.ChatGPTPdfOutline.add(bytes, metadata);
      const filename = `${payload.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120)}.pdf`;
      download(new Blob([result.bytes], { type: "application/pdf" }), filename);
      report(t("directPdfSaved", result.questions, result.pages));
    } catch (error) { report(t("directPdfFailed", error.message), true); }
    finally { setOutputBusy(false); }
  });
  const outlineButton = document.getElementById("add-pdf-outline");
  const outlineFile = document.getElementById("pdf-outline-file");
  outlineButton.addEventListener("click", () => outlineFile.click());
  outlineFile.addEventListener("change", async () => {
    const file = outlineFile.files?.[0];
    outlineFile.value = ""; // Allow retrying the same file after an error.
    if (!file) return;
    if (outputBusy) return;
    setOutputBusy(true);
    try {
      const metadata = pdfMetadata();
      if (file.size > globalThis.ChatGPTPdfOutline.MAX_BYTES) throw new Error(t("pdfTooLarge"));
      report(t("pdfOutlineProgress"));
      const result = await globalThis.ChatGPTPdfOutline.add(await file.arrayBuffer(), metadata);
      download(new Blob([result.bytes], { type: "application/pdf" }), `${file.name.replace(/\.pdf$/i, "")}${t("pdfOutlineSuffix")}.pdf`);
      report(t("pdfOutlineSaved", result.questions, result.pages));
    } catch (error) { report(t("pdfOutlineFailed", error.message), true); }
    finally { setOutputBusy(false); }
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
    if (outputBusy) return;
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
      download(new Blob(["<!doctype html>\n" + exported.documentElement.outerHTML], { type: "text/html;charset=utf-8" }), `${payload.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120)}.html`);
      report(t("htmlSaved"));
    } catch (error) { report(t("saveHtmlFailed", error.message), true); }
  });

  if (initial?.trim()) await start();
})().catch((error) => {
  // This message cannot depend on the catalog that may have failed to load.
  const status = document.getElementById("export-status");
  if (!status) return;
  status.dataset.level = "error";
  status.textContent = globalThis.ChatGPTPdfI18n?.language === "zh-CN"
    ? `导出页初始化失败，请重新加载插件并刷新此页。${error.message}`
    : `Could not initialize the export page. Reload the extension and refresh this page. ${error.message}`;
});
