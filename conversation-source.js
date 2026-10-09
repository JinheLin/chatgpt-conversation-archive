/* Full selected conversation branch, independent of lazy-loaded page messages.
 * ChatGPT's website endpoints are undocumented; fail explicitly if they change.
 * Access tokens are used only in this closure and never returned or stored.
 */
(() => {
  "use strict";
  const { t } = globalThis.ChatGPTPdfI18n;

  function parseUrl(value) {
    let url;
    try { url = new URL(value); } catch (_) { throw new Error(t("invalidUrl")); }
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !["chatgpt.com", "chat.openai.com"].includes(url.hostname)) {
      throw new Error(t("invalidUrl"));
    }
    const match = url.pathname.match(/(?:^|\/)(c|share)\/([a-z0-9-]+)\/?$/i);
    if (!match) throw new Error(t("homepageUrl"));
    url.hash = "";
    url.search = "";
    return { url: url.href, origin: url.origin, kind: match[1].toLowerCase(), id: match[2] };
  }

  function sourceLinks(metadata) {
    const found = new Map();
    function visit(value, depth = 0) {
      if (!value || typeof value !== "object" || depth > 8) return;
      if (typeof value.url === "string" && /^https?:\/\//.test(value.url)) {
        found.set(value.url, { url: value.url, title: value.title || value.name || value.url });
      }
      for (const child of Object.values(value)) if (typeof child === "object") visit(child, depth + 1);
    }
    visit(metadata?.content_references);
    visit(metadata?.citations);
    return [...found.values()];
  }

  function normalize(data, sourceUrl) {
    const root = [data, data?.conversation, data?.data, data?.conversation_data]
      .find((candidate) => candidate?.mapping && typeof candidate.mapping === "object");
    if (!root) throw new Error(t("dataStructureChanged"));
    if (root.has_more === true || root.has_more_messages === true) {
      throw new Error(t("pagedData"));
    }
    const mapping = root.mapping;
    let current = root.current_node;
    if (!current) {
      const leaves = Object.keys(mapping).filter((id) => !mapping[id].children?.length);
      if (leaves.length !== 1) throw new Error(t("ambiguousBranch"));
      current = leaves[0];
    }
    const path = [];
    const seen = new Set();
    while (current) {
      if (seen.has(current) || !mapping[current]) {
        throw new Error(t("incompleteChain"));
      }
      seen.add(current);
      const node = mapping[current];
      path.push(node);
      current = node.parent;
    }
    path.reverse();
    const messages = [];
    for (const node of path) {
      const message = node.message;
      if (["in_progress", "message_pending"].includes(message?.status)) {
        throw new Error(t("generating"));
      }
      const role = message?.author?.role;
      if (role !== "user" && role !== "assistant") continue;
      if (message.metadata?.is_visually_hidden_from_conversation || message.channel === "analysis" ||
          (message.recipient && message.recipient !== "all")) continue;
      const content = message.content || {};
      if (["thoughts", "reasoning_recap", "model_editable_context"].includes(content.content_type)) continue;
      const parts = Array.isArray(content.parts) ? content.parts : [];
      const text = parts.map((part) => typeof part === "string" ? part :
        typeof part?.text === "string" ? part.text : "").filter(Boolean).join("\n") ||
        (typeof content.text === "string" ? content.text : "");
      const attachments = parts.filter((part) => typeof part === "object" && part !== null && typeof part.text !== "string");
      const files = Array.isArray(message.metadata?.attachments) ? message.metadata.attachments : [];
      if (!text.trim() && !attachments.length && !files.length) continue;
      messages.push({
        id: message.id || node.id,
        role,
        text,
        attachments,
        sources: sourceLinks(message.metadata),
        files
      });
    }
    if (!messages.length) throw new Error(t("noMessages"));
    return {
      title: root.title || data.title || t("conversationTitle"),
      sourceUrl,
      capturedAt: new Date().toISOString(),
      messages,
      completeness: { verified: true, count: messages.length, questions: messages.filter((m) => m.role === "user").length,
        firstMessageId: messages[0].id, lastMessageId: messages.at(-1).id }
    };
  }

  async function inlineAssets(payload, headers, onProgress) {
    const cache = new Map();
    let totalBytes = 0;
    const imagesByMessage = payload.messages.map((message) => [...new Set(
      [...message.text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1]))]);
    // Count the same attachment tasks that the loops below will process, including failures.
    const total = payload.messages.reduce((count, message, index) => {
      const seen = new Set(message.attachments.map(pointer).filter(Boolean));
      let files = 0;
      for (const file of message.files) {
        const id = file.id || file.file_id;
        if (!seen.has(id)) { seen.add(id); files++; }
      }
      return count + message.attachments.length + files + imagesByMessage[index].length;
    }, 0);
    let completed = 0;
    const assetDone = () => onProgress({ stage: "assets", completed: ++completed, total });
    if (total) onProgress({ stage: "assets", completed, total });
    async function dataUrl(url) {
      const parsed = new URL(url, location.origin);
      if (!["https:", "http:"].includes(parsed.protocol)) throw new Error(t("unsupportedAssetUrl"));
      const response = await fetch(parsed.href, {
        headers: parsed.origin === location.origin ? headers : {},
        credentials: parsed.origin === location.origin ? "include" : "omit",
        signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) throw new Error(t("assetReadFailed", response.status));
      const blob = await response.blob();
      if (blob.size > 20 * 1024 * 1024 || totalBytes + blob.size > 35 * 1024 * 1024) {
        throw new Error(t("assetTooLarge"));
      }
      totalBytes += blob.size;
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
      });
    }
    async function fileData(id) {
      if (!cache.has(id)) cache.set(id, (async () => {
        const response = await fetch(`/backend-api/files/${encodeURIComponent(id)}/download`, {
          headers, credentials: "include", signal: AbortSignal.timeout(20000)
        });
        if (!response.ok) throw new Error(t("assetLinkFailed", response.status));
        const info = await response.json();
        if (!info.download_url) throw new Error(t("assetLinkMissing"));
        return dataUrl(info.download_url);
      })());
      return cache.get(id);
    }
    function pointer(part) {
      if (!part || typeof part !== "object") return null;
      for (const key of ["image_asset_pointer", "asset_pointer", "audio_asset_pointer", "video_asset_pointer"]) {
        if (typeof part[key] === "string") return part[key].replace(/^(file-service|sediment):\/\//, "");
      }
      for (const value of Object.values(part)) { if (typeof value === "object") { const nested = pointer(value); if (nested) return nested; } }
      return null;
    }
    for (const [index, message] of payload.messages.entries()) {
      message.assets = [];
      const seen = new Set();
      for (const part of message.attachments) {
        const id = pointer(part);
        const file = message.files.find((item) => item.id === id || item.file_id === id);
        const label = file?.name || part.content_type || t("conversationAttachment");
        if (id) seen.add(id);
        try {
          if (!id) throw new Error(t("unsupportedComponent"));
          message.assets.push({ label, dataUrl: await fileData(id) });
        } catch (error) { message.assets.push({ label, error: error.message }); }
        assetDone();
      }
      for (const file of message.files) {
        const id = file.id || file.file_id;
        if (seen.has(id)) continue;
        seen.add(id);
        try {
          if (!id) throw new Error(t("missingAssetId"));
          message.assets.push({ label: file.name || t("attachment"), dataUrl: await fileData(id) });
        } catch (error) { message.assets.push({ label: file.name || t("attachment"), error: error.message }); }
        assetDone();
      }
      for (const url of imagesByMessage[index]) {
        try { message.text = message.text.split(url).join(await dataUrl(url)); }
        catch (_) { /* Renderer marks remote images explicitly instead of silently dropping them. */ }
        assetDone();
      }
      delete message.attachments;
      delete message.files;
    }
    return payload;
  }

  async function readJson(response, onProgress) {
    if (!response.body?.getReader) return response.json();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks = [];
    // Fetch decodes compressed bodies; Content-Length describes decoded bytes only for identity encoding.
    const encoding = response.headers.get("content-encoding");
    const length = Number(response.headers.get("content-length"));
    const total = (!encoding || encoding === "identity") && Number.isSafeInteger(length) && length > 0 ? length : null;
    let received = 0, lastReported = -Infinity;
    const report = () => onProgress({ stage: "conversation", received, ...(total && received <= total ? { completed: received, total } : {}) });
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        received += part.value.byteLength;
        chunks.push(decoder.decode(part.value, { stream: true }));
        const now = performance.now();
        if (now - lastReported >= 100) { report(); lastReported = now; }
      }
      chunks.push(decoder.decode());
      report();
      return JSON.parse(chunks.join(""));
    } finally { reader.releaseLock(); }
  }

  async function read(value, { onProgress = () => {} } = {}) {
    const target = parseUrl(value);
    if (target.url !== parseUrl(location.href).url) throw new Error(t("conversationMismatch"));
    onProgress({ stage: "session" });
    let token = null;
    try {
      const session = await fetch("/api/auth/session", { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(20000) });
      if (session.ok) token = (await session.json()).accessToken || null;
    } catch (_) {
      // Public shared conversations may not require a logged-in session.
    }
    const endpoint = target.kind === "share" ? `/backend-api/share/${target.id}` : `/backend-api/conversation/${target.id}`;
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      onProgress({ stage: "conversation" });
      const response = await fetch(endpoint, { headers, credentials: "include", cache: "no-store", signal: AbortSignal.timeout(60000) });
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) {
          throw new Error(t("readAccessFailed", response.status));
        }
        throw new Error(t("readHttpFailed", response.status));
      }
      const data = await readJson(response, onProgress);
      onProgress({ stage: "verify" });
      return await inlineAssets(normalize(data, target.url), headers, onProgress);
    } finally {
      token = null;
      delete headers.Authorization;
    }
  }

  globalThis.ChatGPTPdfSource = { parseUrl, normalize, read };
})();
