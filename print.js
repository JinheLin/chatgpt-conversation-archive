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
  const previewNavigation = globalThis.ChatGPTPdfPreviewNavigation.init({
    main, sidebar: document.getElementById("preview-sidebar"), layout: document.getElementById("preview-layout")
  });
  const store = globalThis.ChatGPTReaderStore;
  const reader = globalThis.ChatGPTReader.init({ main, layout: document.getElementById("preview-layout"), store });
  const status = document.getElementById("export-status");
  const readProgress = document.getElementById("read-progress");
  const progressLabel = document.getElementById("read-progress-label");
  const progressCount = document.getElementById("read-progress-count");
  const progressBar = document.getElementById("read-progress-bar");
  const progressDetail = document.getElementById("read-progress-detail");
  const progressView = globalThis.ChatGPTPdfReadProgress.init({
    bar: progressBar, fill: document.getElementById("read-progress-fill"), count: progressCount,
    reducedMotion: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  });
  const startButton = document.getElementById("start-export");
  const cancelButton = document.getElementById("cancel-export");
  const actions = document.getElementById("output-actions");
  const pdfFallback = document.getElementById("pdf-fallback");
  pdfFallback.hidden = true;
  const pageLayout = document.getElementById("page-layout");
  const mobileLayout = document.getElementById("mobile-layout");
  let outputBusy = false;
  const workspace = globalThis.ChatGPTReaderWorkspace.init({ document, isBusy: () => outputBusy });
  const exportMenu = globalThis.ChatGPTPdfExportMenu.init({
    root: document.getElementById("export-menu"), button: document.getElementById("export-toggle"),
    popup: document.getElementById("export-formats"),
    items: [document.getElementById("save-html"), document.getElementById("save-pdf")],
    isBusy: () => outputBusy
  });
  const outputControls = [input, startButton, pageLayout, mobileLayout,
    ...["reader-open", "reader-update", "reader-backup", "reader-restore"].map((id) => document.getElementById(id)),
    ...["export-toggle", "save-html", "save-pdf", "print-again", "add-pdf-outline"].map((id) => document.getElementById(id))];
  function setOutputBusy(value) {
    outputBusy = value;
    reader.setLocked(value);
    if (value) exportMenu.close();
    for (const control of outputControls) control.disabled = value;
    for (const control of document.getElementById("reader-library-list").querySelectorAll("button")) control.disabled = value;
  }
  function updatePageLayout() {
    const layout = mobileLayout.checked ? "mobile" : pageLayout.checked ? "landscape" : "portrait";
    const profile = globalThis.ChatGPTPageLayout.resolve(layout);
    document.getElementById("page-direction").textContent = globalThis.ChatGPTPageLayout.css(layout);
    main.dataset.landscape = String(profile.landscape);
    main.dataset.pageLayout = layout;
    document.getElementById("mobile-layout-hint").hidden = layout !== "mobile";
    return layout;
  }
  updatePageLayout();
  let sourceTab = null;
  let generation = 0;
  let payload = null;
  let activeRead = null;
  let readPercent = 0;

  function report(text, error = false, keepProgress = false, transient = false) {
    if (!keepProgress) progressView.stop();
    readProgress.hidden = !keepProgress;
    status.hidden = false;
    status.textContent = text;
    status.dataset.level = error ? "error" : "info";
    workspace.notice(error, transient);
  }
  // Overall workflow milestones, not elapsed time or network byte percentages.
  const progressStages = {
    connect: { label: "progressConnect", percent: 0 },
    session: { label: "progressSession", percent: 10 },
    conversation: { label: "progressConversation", percent: 20 },
    verify: { label: "progressVerify", percent: 55 },
    assets: { label: "progressAssets", percent: 60 },
    layout: { label: "progressLayout", percent: 80 },
    fonts: { label: "progressFonts", percent: 95 },
    complete: { label: "progressComplete", percent: 100 }
  };
  function showReadProgress({ stage, completed, total, received }) {
    if (!Object.hasOwn(progressStages, stage)) return;
    let percent = progressStages[stage].percent;
    if (stage === "assets" || stage === "layout") {
      if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(completed) ||
          completed < 0 || completed > total) return;
      percent += Math.round((stage === "assets" ? 20 : 15) * completed / total);
    } else if (stage === "conversation" && Number.isSafeInteger(total) && total > 0 &&
        Number.isSafeInteger(completed) && completed >= 0 && completed <= total) {
      percent += Math.round(34 * completed / total);
    } else if (stage === "fonts" && Number.isSafeInteger(total) && total > 0 &&
        Number.isSafeInteger(completed) && completed >= 0 && completed <= total) {
      percent += Math.round(4 * completed / total);
    }
    if (percent < readPercent) return;
    readPercent = percent;
    progressLabel.textContent = t(progressStages[stage].label);
    progressView.set(percent);
    let detail = "";
    if (stage === "conversation" && Number.isSafeInteger(received) && received >= 0) {
      const size = received < 1024 * 1024 ? `${(received / 1024).toFixed(1)} KB` : `${(received / (1024 * 1024)).toFixed(1)} MB`;
      detail = t("progressBytes", size);
    } else if (stage === "assets") detail = t("progressAssetCount", completed, total);
    else if (stage === "layout") detail = t("progressMessageCount", completed, total);
    else if (stage === "fonts" && total) detail = t("progressCodeCount", completed, total);
    progressDetail.textContent = detail;
    progressDetail.hidden = !detail;
    status.hidden = true;
    workspace.clearNotice();
    readProgress.hidden = false;
    readProgress.dataset.running = String(stage !== "complete");
  }
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || sender.tab?.id !== activeRead?.tabId ||
        !activeRead || activeRead.generation !== generation || message?.type !== "READ_PROGRESS" ||
        message.readId !== activeRead.id) return;
    if (["session", "conversation", "verify", "assets"].includes(message.progress?.stage)) showReadProgress(message.progress);
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
  let libraryRevision = 0;
  let libraryTimer;
  function formatBytes(bytes) {
    const units = ["B", "KiB", "MiB", "GiB"];
    let unit = 0;
    while (bytes >= 1024 && unit < units.length - 1) { bytes /= 1024; unit++; }
    return new Intl.NumberFormat(language, { maximumFractionDigits: unit ? 1 : 0 }).format(bytes) + " " + units[unit];
  }
  async function deleteConversation(entry) {
    if (outputBusy) return;
    const current = payload && store.keyFor(payload.sourceUrl) === entry.key;
    if (current && !reader.canLeave()) return;
    if (!globalThis.confirm(t("readerDeleteConversationConfirm", entry.title))) return;
    setOutputBusy(true);
    try {
      await store.deleteConversation(entry.key);
      // A refresh must not silently download a deleted conversation, even when
      // the original entry URL points to a different chat from the one displayed.
      const url = new URL(location.href);
      let linked = false;
      try { linked = store.keyFor(url.searchParams.get("source")) === entry.key; } catch (_) { /* No valid source. */ }
      if (current || linked) {
        url.searchParams.delete("source");
        if (current) url.hash = "";
        history.replaceState(null, "", url.href);
      }
      if (current) {
        generation++;
        reader.unload();
        main.replaceChildren(); main.hidden = true;
        previewNavigation.clear();
        payload = null;
        actions.hidden = pdfFallback.hidden = true;
        input.value = "";
        document.title = t("exportPageTitle");
        workspace.opening();
      }
      await refreshLibrary();
      report(t("readerConversationDeleted", entry.title), false, false, true);
    } catch (error) { report(t("readerConversationDeleteFailed", error.message), true); }
    finally { setOutputBusy(false); }
  }
  async function refreshLibrary() {
    clearTimeout(libraryTimer);
    const mine = ++libraryRevision;
    const list = document.getElementById("reader-library-list");
    const total = document.getElementById("reader-library-size");
    try {
      const entries = await store.listConversations();
      if (mine !== libraryRevision) return;
      const focused = document.activeElement;
      const focusedKey = focused?.closest?.(".reader-library-entry")?.dataset.key;
      const focusedClass = focused?.className;
      list.replaceChildren();
      document.getElementById("reader-library-title").textContent = t("readerLibraryCount", entries.length);
      const bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
      total.dataset.bytes = String(bytes);
      total.textContent = t("readerLibraryTotalSize", formatBytes(bytes));
      if (!entries.length) {
        const empty = document.createElement("p"); empty.className = "hint";
        empty.textContent = t("readerLibraryEmpty"); list.appendChild(empty);
      }
      for (const entry of entries) {
        const row = document.createElement("div"); row.className = "reader-library-entry";
        row.dataset.key = entry.key;
        const details = document.createElement("div"); details.className = "reader-library-details";
        const button = document.createElement("button"); button.type = "button";
        button.className = "reader-library-open"; button.disabled = outputBusy;
        button.textContent = entry.title;
        button.addEventListener("click", () => {
          if (outputBusy) return;
          input.value = entry.sourceUrl;
          void start();
        });
        const time = document.createElement("time");
        time.dateTime = entry.capturedAt;
        time.textContent = globalThis.ChatGPTReaderWorkspace.formatTimestamp(entry.capturedAt);
        const size = document.createElement("span"); size.className = "reader-library-entry-size";
        size.dataset.bytes = String(entry.bytes);
        size.textContent = t("readerLibraryEntrySize", formatBytes(entry.bytes));
        const meta = document.createElement("div"); meta.className = "reader-library-entry-meta";
        meta.append(time, size); details.append(button, meta);
        const remove = document.createElement("button"); remove.type = "button";
        remove.className = "reader-library-delete"; remove.disabled = outputBusy;
        remove.textContent = t("readerDeleteConversation");
        remove.setAttribute("aria-label", t("readerDeleteConversationLabel", entry.title));
        remove.addEventListener("click", () => { void deleteConversation(entry); });
        row.append(details, remove); list.appendChild(row);
        if (entry.key === focusedKey) {
          const target = focusedClass === "reader-library-delete" ? remove : button;
          target.focus({ preventScroll: true });
        }
      }
    } catch (error) {
      if (mine !== libraryRevision) return;
      list.textContent = t("readerSaveFailed", error.message);
      total.textContent = ""; delete total.dataset.bytes;
    }
  }
  async function start(event, forceRemote = false) {
    event?.preventDefault();
    if (outputBusy || !reader.canLeave()) return;
    const mine = ++generation;
    setOutputBusy(true);
    cancelButton.hidden = false;
    actions.hidden = true;
    pdfFallback.hidden = true;
    exportMenu.close();
    reader.unload();
    main.hidden = true;
    previewNavigation.clear();
    payload = null;
    activeRead = null;
    readPercent = 0;
    progressView.reset();
    let storageProblem = null;
    try {
      const target = globalThis.ChatGPTPdfSource.parseUrl(input.value.trim());
      const key = store.keyFor(target.url);
      showReadProgress({ stage: "connect" });
      let cached = null;
      if (!forceRemote) {
        try { cached = await store.getConversation(key); }
        catch (error) { storageProblem = error; }
      }
      if (mine !== generation) return;
      if (cached) {
        payload = cached.payload;
      } else {
        if (sourceTab) await chrome.tabs.remove(sourceTab).catch(() => {});
        sourceTab = null;
        // Reuse only the requested conversation; never navigate or close a user's tab.
        const candidates = await chrome.tabs.query({ url: target.origin + "/*" });
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
        sourceTab = existing ? null : tab.id;
        await tabLoaded(tab.id);
        if (mine !== generation) return;
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["i18n.js", "conversation-source.js", "content.js"] });
        if (mine !== generation) return;
        activeRead = { id: crypto.randomUUID(), tabId: tab.id, generation: mine };
        showReadProgress({ stage: "session" });
        const response = await chrome.tabs.sendMessage(tab.id, { type: "READ_FULL_CONVERSATION", source: target.url, readId: activeRead.id });
        if (mine !== generation) return;
        activeRead = null;
        if (!response?.ok) throw new Error(response?.error || t("readFullFailed"));
        payload = response.payload;
        if (store.keyFor(payload.sourceUrl) !== key) throw new Error(t("readerInvalidBackup"));
      }
      const problems = await globalThis.ChatGPTPdfExporter.render(payload, main, {
        isCancelled: () => mine !== generation,
        onProgress: ({ completed, total }) => {
          if (mine === generation) showReadProgress({ stage: "layout", completed, total });
        }
      });
      if (mine !== generation) return;
      document.title = payload.title + " — " + t("readerTitle");
      showReadProgress({ stage: "fonts" });
      await document.fonts.ready;
      if (mine !== generation) return;
      await globalThis.ChatGPTPdfExporter.fitCode(main, updatePageLayout(), {
        isCancelled: () => mine !== generation,
        onProgress: ({ completed, total }) => {
          if (mine === generation) showReadProgress({ stage: "fonts", completed, total });
        }
      });
      if (mine !== generation) return;
      if (!cached) {
        try { await store.saveConversation(payload); storageProblem = null; }
        catch (error) { storageProblem = error; }
      }
      if (mine !== generation) return;
      await reader.load(key, !storageProblem);
      if (mine !== generation) return;
      previewNavigation.refresh();
      actions.hidden = false;
      workspace.reading(payload, !storageProblem);
      showReadProgress({ stage: "complete" });
      const verified = t("readVerified", payload.messages.length, payload.completeness.questions,
        problems.length ? t("assetProblems", problems.length) : t("readyOutput"));
      report(storageProblem ? t("readerSnapshotFailed", storageProblem.message) :
        cached ? t("readerOpenedLocal", new Date(payload.capturedAt).toLocaleString(language)) : verified, !!storageProblem, true);
      // Keep the confirmed 100% value, then remove the completed workflow from the reading view.
      readProgress.hidden = true;
      if (!storageProblem && !problems.length) workspace.clearNotice();
      if (sourceTab) {
        await chrome.tabs.remove(sourceTab).catch(() => {});
        sourceTab = null;
      }
      await refreshLibrary();
    } catch (error) {
      if (mine === generation) {
        main.hidden = true; previewNavigation.clear(); reader.unload(); payload = null;
        workspace.opening();
        report(error.message || t("readFailed"), true);
      }
    } finally {
      if (mine === generation) {
        activeRead = null;
        setOutputBusy(false);
        cancelButton.hidden = true;
      }
    }
  }
  document.getElementById("export-form").addEventListener("submit", start);
  cancelButton.addEventListener("click", async () => {
    generation++;
    reader.unload();
    activeRead = null;
    main.hidden = true;
    previewNavigation.clear();
    actions.hidden = true;
    payload = null;
    workspace.opening();
    report(t("cancelled"));
    if (sourceTab) await chrome.tabs.remove(sourceTab).catch(() => {});
    sourceTab = null;
    setOutputBusy(false);
    cancelButton.hidden = true;
  });
  async function changeLayout(control, other) {
    if (outputBusy) return;
    if (control.checked) other.checked = false;
    setOutputBusy(true);
    try {
      await globalThis.ChatGPTPdfExporter.fitCode(main, updatePageLayout());
    } catch (error) { report(error.message, true); }
    finally { setOutputBusy(false); }
  }
  pageLayout.addEventListener("change", () => changeLayout(pageLayout, mobileLayout));
  mobileLayout.addEventListener("change", () => changeLayout(mobileLayout, pageLayout));
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
    exportMenu.close({ restoreFocus: true });
    pdfFallback.hidden = true;
    setOutputBusy(true);
    try {
      const metadata = pdfMetadata();
      report(t("directPdfProgress"));
      await document.fonts.ready;
      await Promise.all([...main.querySelectorAll("img")].map((image) => image.decode()));
      const layout = updatePageLayout();
      await globalThis.ChatGPTPdfExporter.fitCode(main, layout);
      const bytes = await globalThis.ChatGPTPdfCapture.capture({ pageLayout: layout });
      report(t("pdfOutlineProgress"));
      const result = await globalThis.ChatGPTPdfOutline.add(bytes, metadata);
      const filename = `${payload.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120)}${layout === "mobile" ? "-mobile" : ""}.pdf`;
      download(new Blob([result.bytes], { type: "application/pdf" }), filename);
      report(t("directPdfSaved", result.questions, result.pages), false, false, true);
    } catch (error) {
      report(t("directPdfFailed", error.message), true);
      pdfFallback.hidden = !payload || main.hidden;
    }
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
      report(t("pdfOutlineSaved", result.questions, result.pages), false, false, true);
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
    exportMenu.close({ restoreFocus: true });
    setOutputBusy(true);
    try {
      if (!payload) throw new Error(t("readFirst"));
      const css = await offlineCss();
      const exported = document.implementation.createHTMLDocument(payload.title);
      exported.documentElement.lang = language;
      const charset = exported.createElement("meta"); charset.setAttribute("charset", "utf-8"); exported.head.prepend(charset);
      const viewport = exported.createElement("meta"); viewport.name = "viewport"; viewport.content = "width=device-width, initial-scale=1";
      exported.head.appendChild(viewport);
      const csp = exported.createElement("meta"); csp.httpEquiv = "Content-Security-Policy";
      csp.content = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'none'";
      exported.head.appendChild(csp);
      const style = exported.createElement("style"); style.textContent = css + "\n" + document.getElementById("page-direction").textContent;
      exported.head.appendChild(style);
      exported.body.className = "pdf-print-page pdf-offline";
      const transcript = main.cloneNode(true);
      globalThis.ChatGPTReaderAnchor.clear(transcript);
      exported.body.appendChild(transcript);
      download(new Blob(["<!doctype html>\n" + exported.documentElement.outerHTML], { type: "text/html;charset=utf-8" }), `${payload.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120)}.html`);
      report(t("htmlSaved"), false, false, true);
    } catch (error) { report(t("saveHtmlFailed", error.message), true); }
    finally { setOutputBusy(false); }
  });

  document.getElementById("reader-update").addEventListener("click", () => {
    if (payload && !outputBusy) { input.value = payload.sourceUrl; return start(null, true); }
  });
  document.getElementById("reader-backup").addEventListener("click", async () => {
    if (outputBusy) return;
    setOutputBusy(true);
    try {
      const data = await store.backup();
      const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
      if (blob.size > store.MAX_BACKUP_BYTES) throw new Error(t("readerBackupTooLarge"));
      download(blob, "chatgpt-reader-backup-" + new Date().toISOString().slice(0, 10) + ".json");
      report(t("readerBackupSaved"), false, false, true);
    } catch (error) { report(t("readerBackupFailed", error.message), true); }
    finally { setOutputBusy(false); }
  });
  const backupFile = document.getElementById("reader-backup-file");
  document.getElementById("reader-restore").addEventListener("click", () => { if (!outputBusy) backupFile.click(); });
  backupFile.addEventListener("change", async () => {
    const file = backupFile.files?.[0];
    backupFile.value = "";
    if (!file || outputBusy || !reader.canLeave()) return;
    setOutputBusy(true);
    let restored = false;
    const current = payload?.sourceUrl;
    try {
      if (file.size > store.MAX_BACKUP_BYTES) throw new Error(t("readerBackupTooLarge"));
      const result = await store.restore(JSON.parse(await file.text()));
      await refreshLibrary();
      report(t("readerBackupRestored", result.conversations, result.annotations), false, false, true);
      restored = true;
    } catch (error) { report(t("readerBackupFailed", error.message), true); }
    finally { setOutputBusy(false); }
    if (restored && current) { reader.unload(); input.value = current; await start(); }
  });
  store.subscribe?.(() => {
    clearTimeout(libraryTimer);
    libraryTimer = setTimeout(() => { void refreshLibrary(); }, 50);
  });
  await refreshLibrary();
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
