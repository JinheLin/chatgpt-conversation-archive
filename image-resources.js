/* Read image resources in a disposable ChatGPT tab using the existing debugger
 * permission. This avoids adding image-server host permissions. No page scripts,
 * cookies, access tokens or authentication headers are read through the debugger.
 */
(() => {
  "use strict";
  const MAX_IMAGE = 20 * 1024 * 1024;
  const MAX_TOTAL = 35 * 1024 * 1024;
  const allowed = value => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "images.openai.com" && !url.port &&
        !url.username && !url.password && /^\/(?:static-rsc(?:-\d+)?|thumbnails)\//.test(url.pathname);
    } catch (_) { return false; }
  };

  async function capture(tabId, sourceUrl, payload, { isCancelled = () => false, onProgress = () => {} } = {}) {
    const tasks = payload.messages.flatMap(message => (message.imageSources || []).filter(image =>
      allowed(image.url) && !(message.layoutImages || []).some(saved => saved.slot === image.slot && saved.query === image.query))
      .map(image => ({ message, image })));
    if (!tasks.length || !chrome.debugger) return;
    const tab = await chrome.tabs.get(tabId);
    if (!Number.isInteger(tabId) || globalThis.ChatGPTPdfSource.parseUrl(tab.url).url !==
        globalThis.ChatGPTPdfSource.parseUrl(sourceUrl).url || payload.sourceUrl !== sourceUrl || isCancelled()) return;
    const target = { tabId };
    let attached = false, total = 0, completed = 0;
    const cache = new Map();
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Image resource timed out")), 15000);
      chrome.debugger.sendCommand(target, method, params).then(resolve, reject).finally(() => clearTimeout(timer));
    });
    const detachOnLeave = () => { if (attached) chrome.debugger.detach(target).catch(() => {}); };
    async function pixels(frameId, url) {
      let stream;
      try {
        const { resource } = await command("Network.loadNetworkResource", {
          frameId, url, options: { disableCache: false, includeCredentials: false }
        });
        stream = resource?.stream;
        const mime = Object.entries(resource?.headers || {}).find(([key]) => key.toLowerCase() === "content-type")?.[1]?.split(";")[0].trim();
        if (!resource?.success || resource.httpStatusCode !== 200 || !stream || !/^image\/(?:png|jpeg|gif|webp)$/i.test(mime || "")) {
          throw new Error("Image resource unavailable");
        }
        const chunks = [];
        let size = 0;
        for (;;) {
          if (isCancelled()) throw new Error("Image capture cancelled");
          const part = await command("IO.read", { handle: stream, size: 1024 * 1024 });
          if (typeof part?.data !== "string") throw new Error("Image resource unavailable");
          const chunk = part.base64Encoded ? Uint8Array.from(atob(part.data), char => char.charCodeAt(0)) : new TextEncoder().encode(part.data);
          size += chunk.length;
          if (size > MAX_IMAGE || total + size > MAX_TOTAL) throw new Error("Image resource too large");
          chunks.push(chunk);
          if (part.eof) break;
          if (!chunk.length) throw new Error("Empty image stream");
        }
        if (!size) throw new Error("Empty image stream");
        total += size;
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result); reader.onerror = reject;
          reader.readAsDataURL(new Blob(chunks, { type: mime.toLowerCase() }));
        });
      } finally {
        if (stream) await command("IO.close", { handle: stream }).catch(() => {});
      }
    }
    try {
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      globalThis.addEventListener("pagehide", detachOnLeave);
      const { frameTree } = await command("Page.getFrameTree");
      for (const { message, image } of tasks) {
        if (isCancelled()) break;
        try {
          if (!cache.has(image.url)) cache.set(image.url, pixels(frameTree.frame.id, image.url));
          const dataUrl = await cache.get(image.url);
          (message.layoutImages ||= []).push({ slot: image.slot, query: image.query, dataUrl });
        } catch (_) { /* Preserve the renderer's explicit unavailable marker. */ }
        onProgress({ completed: ++completed, total: tasks.length });
      }
    } finally {
      if (attached) await chrome.debugger.detach(target).catch(() => {});
      globalThis.removeEventListener("pagehide", detachOnLeave);
    }
  }
  globalThis.ChatGPTImageResources = { capture, allowed };
})();
