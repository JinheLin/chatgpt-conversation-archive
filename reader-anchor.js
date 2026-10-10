/* Stable text quotes and offsets within one message, independent of DOM paths. */
(() => {
  "use strict";
  const EXCLUDED = ".katex, svg, math, .pdf-sources, .pdf-citation, figure, .pdf-asset-warning";
  async function hash(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  async function quote(text, start, end) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > text.length || end <= start) return null;
    return { exact: text.slice(start, end), prefix: text.slice(Math.max(0, start - 32), start),
      suffix: text.slice(end, end + 32), start, end, hash: await hash(text) };
  }
  async function locate(text, anchor, digest) {
    if (!anchor?.exact) return null;
    if (text.slice(anchor.start, anchor.end) === anchor.exact && (digest || await hash(text)) === anchor.hash) {
      return { start: anchor.start, end: anchor.end };
    }
    const candidates = [];
    for (let from = 0; from <= text.length;) {
      const start = text.indexOf(anchor.exact, from);
      if (start < 0) break;
      candidates.push({ start, end: start + anchor.exact.length });
      from = start + 1;
    }
    if (candidates.length === 1) return candidates[0];
    const contextual = candidates.filter(({ start, end }) =>
      text.slice(Math.max(0, start - anchor.prefix.length), start) === anchor.prefix &&
      text.slice(end, end + anchor.suffix.length) === anchor.suffix);
    return contextual.length === 1 ? contextual[0] : null;
  }
  function index(body) {
    const document = body.ownerDocument;
    const walker = document.createTreeWalker(body, 4); // NodeFilter.SHOW_TEXT
    const nodes = [];
    let text = "", node;
    while ((node = walker.nextNode())) {
      if (node.parentElement.closest(EXCLUDED)) continue;
      const start = text.length;
      text += node.data;
      nodes.push({ node, start, end: text.length });
    }
    return { text, nodes };
  }
  function pointOffset(entries, container, offset, document) {
    const point = document.createRange();
    point.setStart(container, offset); point.collapse(true);
    for (const entry of entries) {
      if (entry.node === container) return entry.start + offset;
      if (point.comparePoint(entry.node, 0) >= 0) return entry.start;
    }
    return entries.at(-1)?.end || 0;
  }
  async function capture(range, main) {
    const element = (node) => node.nodeType === 1 ? node : node.parentElement;
    const body = element(range.startContainer)?.closest(".pdf-message-body");
    if (!body || !main.contains(body) || element(range.endContainer)?.closest(".pdf-message-body") !== body) return null;
    // Never flatten formulas, SVG, citations or attachment labels into a text anchor.
    if ([...body.querySelectorAll(EXCLUDED)].some((node) => range.intersectsNode(node))) return null;
    const section = body.closest("[data-message-id]");
    if (!section?.dataset.messageId) return null;
    const entries = index(body);
    const start = pointOffset(entries.nodes, range.startContainer, range.startOffset, body.ownerDocument);
    const end = pointOffset(entries.nodes, range.endContainer, range.endOffset, body.ownerDocument);
    const anchor = await quote(entries.text, start, end);
    if (!anchor?.exact.trim() || anchor.exact.length > 100000) return null;
    return { messageId: section.dataset.messageId, anchor };
  }
  function clear(root) {
    for (const mark of root.querySelectorAll("mark.reader-highlight")) mark.replaceWith(...mark.childNodes);
    // Normalize only highlighted bodies; no global rewriting of unrelated SVG/math.
    for (const body of root.querySelectorAll(".pdf-message-body")) body.normalize();
  }
  function paint(body, entries, located) {
    const document = body.ownerDocument;
    for (const entry of entries.nodes) {
      const relevant = located.filter((item) => item.start < entry.end && item.end > entry.start);
      if (!relevant.length) continue;
      const boundaries = new Set([0, entry.node.length]);
      for (const item of relevant) {
        boundaries.add(Math.max(0, item.start - entry.start));
        boundaries.add(Math.min(entry.node.length, item.end - entry.start));
      }
      const positions = [...boundaries].sort((a, b) => a - b);
      const fragment = document.createDocumentFragment();
      for (let i = 1; i < positions.length; i++) {
        const start = positions[i - 1], end = positions[i];
        const text = document.createTextNode(entry.node.data.slice(start, end));
        const active = relevant.filter((item) => item.start < entry.start + end && item.end > entry.start + start);
        if (!active.length) { fragment.appendChild(text); continue; }
        const mark = document.createElement("mark");
        mark.className = "reader-highlight";
        mark.dataset.annotationIds = JSON.stringify(active.map((item) => item.id));
        mark.dataset.comment = String(active.some((item) => item.comment));
        mark.appendChild(text); fragment.appendChild(mark);
      }
      entry.node.replaceWith(fragment);
    }
  }
  async function apply(main, annotations, { isCancelled = () => false } = {}) {
    clear(main);
    const bodies = new Map([...main.querySelectorAll(".pdf-message[data-message-id]")].map((section) =>
      [section.dataset.messageId, section.querySelector(".pdf-message-body")]));
    const results = new Map(), groups = new Map();
    for (const annotation of annotations) {
      if (!groups.has(annotation.messageId)) groups.set(annotation.messageId, []);
      groups.get(annotation.messageId).push(annotation);
    }
    for (const [messageId, group] of groups) {
      const body = bodies.get(messageId);
      const entries = body ? index(body) : null;
      const digest = entries ? await hash(entries.text) : null;
      if (isCancelled()) return null;
      const located = [];
      for (const annotation of group) {
        const position = entries ? await locate(entries.text, annotation.anchor, digest) : null;
        if (isCancelled()) return null;
        // Return current offsets so the reader can order relocated annotations.
        results.set(annotation.id, position);
        if (position) located.push({ ...position, id: annotation.id, comment: annotation.comment });
      }
      if (body) paint(body, entries, located);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (isCancelled()) return null;
    }
    return results;
  }
  globalThis.ChatGPTReaderAnchor = { quote, locate, index, capture, clear, apply };
})();
