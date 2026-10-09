/* Chrome renders this extension's export tab directly to PDF.
 * Never attach to ChatGPT or another user's tab. The connection is transient.
 * Read the result as a stream to avoid large base64 replies for long exports.
 */
(() => {
  "use strict";
  const { t } = globalThis.ChatGPTPdfI18n;
  const MAX_BYTES = 100 * 1024 * 1024;
  let busy = false;

  async function capture({ landscape = false, pageLayout } = {}) {
    if (busy) throw new Error(t("pdfExportBusy"));
    busy = true;
    let target, attached = false, stream;
    const detachOnLeave = () => { if (attached) chrome.debugger.detach(target).catch(() => {}); };
    try {
      const page = globalThis.ChatGPTPageLayout.resolve(pageLayout ?? landscape);
      if (!chrome.debugger) throw new Error(t("pdfDebuggerRequired"));
      const tab = await chrome.tabs.getCurrent();
      // Only this page may be printed. No caller-provided target or active-tab query.
      const expected = new URL(chrome.runtime.getURL("print.html"));
      const current = new URL(tab?.url || "about:blank");
      if (!Number.isInteger(tab?.id) || current.protocol !== expected.protocol || current.host !== expected.host || current.pathname !== expected.pathname) {
        throw new Error(t("pdfExportWrongPage"));
      }
      target = { tabId: tab.id };
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      globalThis.addEventListener("pagehide", detachOnLeave);
      const result = await chrome.debugger.sendCommand(target, "Page.printToPDF", {
        landscape: page.landscape, printBackground: true, displayHeaderFooter: false, scale: 1,
        paperWidth: page.width / 25.4, paperHeight: page.height / 25.4,
        marginTop: page.top / 25.4, marginBottom: page.bottom / 25.4,
        marginLeft: page.left / 25.4, marginRight: page.right / 25.4,
        preferCSSPageSize: true, pageRanges: "", transferMode: "ReturnAsStream",
        generateTaggedPDF: true, generateDocumentOutline: false
      });
      // Custom question bookmarks are added locally after capture. Automatic
      // heading outlines would include answer headings instead of question titles.
      stream = result?.stream;
      if (!stream) throw new Error(t("pdfExportNoData"));
      const chunks = [];
      let size = 0;
      for (;;) {
        const part = await chrome.debugger.sendCommand(target, "IO.read", { handle: stream, size: 1024 * 1024 });
        if (typeof part?.data !== "string") throw new Error(t("pdfExportNoData"));
        const chunk = part.base64Encoded
          ? Uint8Array.from(atob(part.data), (char) => char.charCodeAt(0))
          : new TextEncoder().encode(part.data);
        size += chunk.length;
        if (size > MAX_BYTES) throw new Error(t("pdfTooLarge"));
        chunks.push(chunk);
        if (part.eof) break;
        if (!chunk.length) throw new Error(t("pdfExportNoData"));
      }
      if (!size) throw new Error(t("pdfExportNoData"));
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return bytes;
    } finally {
      if (stream) await chrome.debugger.sendCommand(target, "IO.close", { handle: stream }).catch(() => {});
      if (attached) await chrome.debugger.detach(target).catch(() => {});
      globalThis.removeEventListener("pagehide", detachOnLeave);
      busy = false;
    }
  }

  globalThis.ChatGPTPdfCapture = { capture };
})();
