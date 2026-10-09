/* Deterministic, offline renderer. Message HTML never executes conversation code. */
(() => {
  "use strict";
  const { t, language } = globalThis.ChatGPTPdfI18n;
  const md = globalThis.markdownit({ html: false, linkify: true, breaks: false, typographer: false });
  globalThis.ChatGPTArchiveLayout.install(md);
  globalThis.ChatGPTPdfCitations.install(md);
  const mathHtml = (source, displayMode) => globalThis.katex.renderToString(source, {
    displayMode, throwOnError: false, trust: false, strict: "ignore", output: "htmlAndMathml"
  });

  md.inline.ruler.before("escape", "archive_math", (state, silent) => {
    const start = state.pos;
    const input = state.src.slice(start);
    let open, close, display = false;
    if (input.startsWith("\\(")) { open = "\\("; close = "\\)"; }
    else if (input.startsWith("\\[")) { open = "\\["; close = "\\]"; display = true; }
    else if (input.startsWith("$$")) { open = close = "$$"; display = true; }
    else if (input.startsWith("$") && !/^\$\s/.test(input)) { open = close = "$"; }
    else return false;
    let end = state.src.indexOf(close, start + open.length);
    while (end >= 0 && state.src[end - 1] === "\\") end = state.src.indexOf(close, end + close.length);
    if (end < 0 || (close === "$" && /\s/.test(state.src[end - 1]))) return false;
    if (!silent) {
      const token = state.push("archive_math", "", 0);
      token.content = state.src.slice(start + open.length, end);
      token.meta = { display };
    }
    state.pos = end + close.length;
    return true;
  });
  md.renderer.rules.archive_math = (tokens, index) => mathHtml(tokens[index].content, tokens[index].meta.display);
  md.block.ruler.before("fence", "archive_math_block", (state, start, end, silent) => {
    const line = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]).trim();
    const open = line.startsWith("$$") ? "$$" : line.startsWith("\\[") ? "\\[" : null;
    if (!open) return false;
    const close = open === "$$" ? "$$" : "\\]";
    let content = line.slice(open.length);
    let last = start;
    if (!content.endsWith(close)) {
      while (++last < end) {
        const next = state.src.slice(state.bMarks[last], state.eMarks[last]);
        content += "\n" + next;
        if (next.trimEnd().endsWith(close)) break;
      }
      if (last >= end) return false;
    }
    if (!silent) {
      const token = state.push("archive_math_block", "", 0);
      token.content = content.trimEnd().slice(0, -close.length);
      token.block = true;
      state.line = last + 1;
    }
    return true;
  });
  md.renderer.rules.archive_math_block = (tokens, index) => mathHtml(tokens[index].content, true) + "\n";

  function preserveDiagrams(text) {
    const lines = text.split("\n");
    const output = [];
    let fence = null;
    for (let i = 0; i < lines.length;) {
      const marker = lines[i].match(/^\s*(`{3,}|~{3,})/);
      if (marker) {
        if (!fence) fence = marker[1][0];
        else if (fence === marker[1][0]) fence = null;
        output.push(lines[i++]);
        continue;
      }
      if (fence || !lines[i].trim()) { output.push(lines[i++]); continue; }
      let j = i + 1;
      while (j < lines.length && lines[j].trim() && !/^\s*(`{3,}|~{3,})/.test(lines[j])) j++;
      const block = lines.slice(i, j).join("\n");
      if (j - i >= 2 && !/<(?:box|grid|row|svg)\b/.test(block) &&
          (/[┌┐└┘├┤┬┴┼│─]/.test(block) || /\+[-=]{3,}\+/.test(block))) {
        output.push("```text", block, "```");
      } else output.push(block);
      i = j;
    }
    return output.join("\n");
  }

  function plainQuestion(text, number) {
    const request = text.split(/^#{0,6}\s*My request:\s*$/mi).at(-1);
    const container = document.createElement("div");
    container.innerHTML = md.render(request, { archiveHideCitations: true });
    const original = container.textContent.replace(/\s+/g, " ").trim();
    const withoutUrls = original.replace(/https?[:\\]+\/\/\S+/g, "").trim();
    const title = withoutUrls || original;
    return title ? title.slice(0, 100) + (title.length > 100 ? "…" : "") : t("questionWithAttachments", number);
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const yieldToPage = () => new Promise((resolve) => setTimeout(resolve, 0));
  async function render(payload, main, { onProgress = () => {}, isCancelled = () => false } = {}) {
    if (!payload.completeness?.verified || payload.messages.length !== payload.completeness.count) {
      throw new Error(t("countMismatch"));
    }
    main.replaceChildren();
    main.hidden = true;
    main.appendChild(el("h1", "pdf-title", payload.title));
    main.appendChild(el("p", "pdf-meta", t("conversationMeta", payload.messages.length, payload.completeness.questions, new Date(payload.capturedAt).toLocaleString(language))));
    if (payload.sourceUrl) {
      const provenance = el("p", "pdf-meta");
      const link = el("a", "", t("originalLink"));
      link.href = payload.sourceUrl;
      provenance.appendChild(link);
      main.appendChild(provenance);
    }
    const nav = el("nav", "pdf-toc");
    nav.id = "question-index";
    nav.setAttribute("aria-label", t("questionNav"));
    nav.appendChild(el("h2", "", t("questionIndex")));
    const list = el("ol");
    nav.appendChild(list);
    main.appendChild(nav);
    let question = 0;
    const problems = [];
    onProgress({ completed: 0, total: payload.messages.length });
    await yieldToPage();
    let sliceStart = performance.now();
    for (const [index, message] of payload.messages.entries()) {
      if (isCancelled()) throw new Error(t("cancelled"));
      const section = el("section", `pdf-message pdf-${message.role}`);
      if (message.role === "user") {
        question++;
        section.id = `question-${question}`;
        const item = el("li");
        const link = el("a", "", plainQuestion(message.text, question));
        link.setAttribute("href", `#${section.id}`);
        item.appendChild(link);
        list.appendChild(item);
      } else section.id = `message-${index + 1}`;
      section.dataset.messageId = message.id;
      section.appendChild(el("h2", "pdf-role", message.role === "user" ? t("questionLabel", question) : t("answerLabel")));
      const body = el("div", "pdf-message-body");
      // html:false and KaTeX trust:false; do not execute HTML from the transcript.
      const sourceId = `sources-${index + 1}`;
      const sources = (message.sources || []).filter((source) => /^https?:\/\//.test(source.url));
      body.innerHTML = md.render(preserveDiagrams(message.text), { archiveSourcesId: sources.length ? sourceId : null });
      section.appendChild(body);
      for (const asset of message.assets || []) {
        if (asset.dataUrl) {
          const figure = el("figure");
          if (asset.dataUrl.startsWith("data:image/")) {
            const img = el("img");
            img.src = asset.dataUrl;
            img.alt = asset.label || t("conversationImage");
            figure.appendChild(img);
          } else {
            const link = el("a", "", t("downloadAttachment", asset.label || t("downloadFile")));
            link.href = asset.dataUrl;
            link.download = asset.label || "attachment";
            figure.appendChild(link);
          }
          if (asset.label) figure.appendChild(el("figcaption", "", asset.label));
          body.appendChild(figure);
        } else {
          const description = asset.error || t("assetDisplayFailed");
          body.appendChild(el("p", "pdf-asset-warning", t("assetWarning", asset.label || t("unnamedAttachment"), description)));
          problems.push(t("assetProblemDetail", asset.label || t("attachment"), description));
        }
      }
      for (const img of body.querySelectorAll("img")) {
        if (!img.getAttribute("src")?.startsWith("data:")) {
          const label = img.alt || img.getAttribute("src") || t("imageLabel");
          img.replaceWith(el("p", "pdf-asset-warning", t("imageNotEmbedded", label)));
          problems.push(t("imageNotEmbedded", label));
        }
      }
      if (sources.length) {
        const details = el("div", "pdf-sources");
        details.id = sourceId;
        details.appendChild(el("p", "", t("sourceHeading")));
        const links = el("ul");
        for (const source of sources) {
          const item = el("li");
          const link = el("a", "", source.title || source.url);
          link.href = source.url;
          item.appendChild(link);
          links.appendChild(item);
        }
        details.appendChild(links);
        body.appendChild(details);
      }
      const back = el("a", "pdf-back", t("backIndex"));
      back.href = "#question-index";
      section.appendChild(back);
      main.appendChild(section);
      if (performance.now() - sliceStart >= 8 || index + 1 === payload.messages.length) {
        onProgress({ completed: index + 1, total: payload.messages.length });
        await yieldToPage();
        sliceStart = performance.now();
      }
    }
    if (isCancelled()) throw new Error(t("cancelled"));
    if (main.querySelectorAll("section.pdf-message").length !== payload.completeness.count || question !== payload.completeness.questions) {
      throw new Error(t("renderMismatch"));
    }
    main.hidden = false;
    return problems;
  }

  async function fitCode(main, landscape = false, { isCancelled = () => false, onProgress = () => {} } = {}) {
    if (isCancelled()) throw new Error(t("cancelled"));
    const width = ((landscape ? 297 : 210) - 34) * 96 / 25.4 - 26;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const blocks = [...main.querySelectorAll("pre")];
    // Group style writes and reads so every block does not force a document layout.
    for (const pre of blocks) pre.style.fontSize = "10pt";
    const fonts = blocks.map((pre) => {
      const style = getComputedStyle(pre);
      return `${style.fontSize} ${style.fontFamily}`;
    });
    const sizes = [];
    let sliceStart = performance.now();
    for (const [index, pre] of blocks.entries()) {
      if (isCancelled()) throw new Error(t("cancelled"));
      ctx.font = fonts[index];
      let widest = 0;
      for (const raw of pre.textContent.split("\n")) {
        let line = "", col = 0;
        for (const char of raw) {
          if (char === "\t") { const spaces = 4 - col % 4; line += " ".repeat(spaces); col += spaces; }
          else { line += char; col++; }
        }
        widest = Math.max(widest, ctx.measureText(line).width);
        if (performance.now() - sliceStart >= 8) {
          await yieldToPage();
          if (isCancelled()) throw new Error(t("cancelled"));
          sliceStart = performance.now();
        }
      }
      sizes.push(widest > width ? `${10 * width / widest}pt` : "10pt");
      onProgress({ completed: index + 1, total: blocks.length });
    }
    if (isCancelled()) throw new Error(t("cancelled"));
    blocks.forEach((pre, index) => { pre.style.fontSize = sizes[index]; });
  }

  globalThis.ChatGPTPdfExporter = { render, fitCode, preserveDiagrams };
})();
