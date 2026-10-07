/* Full selected conversation branch, independent of lazy-loaded page messages.
 * ChatGPT's website endpoints are undocumented; fail explicitly if they change.
 * Access tokens are used only in this closure and never returned or stored.
 */
(() => {
  "use strict";

  function parseUrl(value) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !["chatgpt.com", "chat.openai.com"].includes(url.hostname)) {
      throw new Error("请输入 https://chatgpt.com 的对话链接。");
    }
    const match = url.pathname.match(/(?:^|\/)(c|share)\/([a-z0-9-]+)\/?$/i);
    if (!match) throw new Error("链接应为 ChatGPT 对话或共享对话，不能是首页链接。");
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
    if (!root) throw new Error("完整对话数据结构已变化，无法校验完整性。未生成不完整文件。");
    if (root.has_more === true || root.has_more_messages === true) {
      throw new Error("服务端返回的是分页片段，无法校验完整性。未生成不完整文件。");
    }
    const mapping = root.mapping;
    let current = root.current_node;
    if (!current) {
      const leaves = Object.keys(mapping).filter((id) => !mapping[id].children?.length);
      if (leaves.length !== 1) throw new Error("无法确定当前对话分支，未生成文件。");
      current = leaves[0];
    }
    const path = [];
    const seen = new Set();
    while (current) {
      if (seen.has(current) || !mapping[current]) {
        throw new Error("对话消息链不完整或存在循环，未生成文件。");
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
        throw new Error("对话仍在生成，请等待回复结束后再导出。");
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
    if (!messages.length) throw new Error("此对话没有可导出的用户或助手消息。");
    return {
      title: root.title || data.title || "ChatGPT 对话",
      sourceUrl,
      capturedAt: new Date().toISOString(),
      messages,
      completeness: { verified: true, count: messages.length, questions: messages.filter((m) => m.role === "user").length,
        firstMessageId: messages[0].id, lastMessageId: messages.at(-1).id }
    };
  }

  async function inlineAssets(payload, headers) {
    const cache = new Map();
    let totalBytes = 0;
    async function dataUrl(url) {
      const parsed = new URL(url, location.origin);
      if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("不支持的附件地址");
      const response = await fetch(parsed.href, {
        headers: parsed.origin === location.origin ? headers : {},
        credentials: parsed.origin === location.origin ? "include" : "omit",
        signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) throw new Error(`附件读取失败（${response.status}）`);
      const blob = await response.blob();
      if (blob.size > 20 * 1024 * 1024 || totalBytes + blob.size > 35 * 1024 * 1024) {
        throw new Error("附件过大，无法内嵌到单文件 HTML");
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
        if (!response.ok) throw new Error(`附件下载链接不可用（${response.status}）`);
        const info = await response.json();
        if (!info.download_url) throw new Error("附件下载地址不可用");
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
    for (const message of payload.messages) {
      message.assets = [];
      const seen = new Set();
      for (const part of message.attachments) {
        const id = pointer(part);
        const file = message.files.find((item) => item.id === id || item.file_id === id);
        const label = file?.name || part.content_type || "对话附件";
        if (id) seen.add(id);
        try {
          if (!id) throw new Error("此特殊组件无法完整转换为静态 HTML");
          message.assets.push({ label, dataUrl: await fileData(id) });
        } catch (error) { message.assets.push({ label, error: error.message }); }
      }
      for (const file of message.files) {
        const id = file.id || file.file_id;
        if (seen.has(id)) continue;
        seen.add(id);
        try {
          if (!id) throw new Error("附件没有下载标识");
          message.assets.push({ label: file.name || "附件", dataUrl: await fileData(id) });
        } catch (error) { message.assets.push({ label: file.name || "附件", error: error.message }); }
      }
      const images = [...new Set([...message.text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1]))];
      for (const url of images) {
        try { message.text = message.text.split(url).join(await dataUrl(url)); }
        catch (_) { /* Renderer marks remote images explicitly instead of silently dropping them. */ }
      }
      delete message.attachments;
      delete message.files;
    }
    return payload;
  }

  async function read(value) {
    const target = parseUrl(value);
    if (target.url !== parseUrl(location.href).url) throw new Error("当前页面与输入的对话链接不一致，请重试。");
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
      const response = await fetch(endpoint, { headers, credentials: "include", cache: "no-store", signal: AbortSignal.timeout(60000) });
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) {
          throw new Error(`无法读取完整对话（${response.status}）。请在此 Chrome 账号登录并确认有权访问该链接。`);
        }
        throw new Error(`读取完整对话失败（${response.status}），请稍后重试。`);
      }
      return await inlineAssets(normalize(await response.json(), target.url), headers);
    } finally {
      token = null;
      delete headers.Authorization;
    }
  }

  globalThis.ChatGPTPdfSource = { parseUrl, normalize, read };
})();
