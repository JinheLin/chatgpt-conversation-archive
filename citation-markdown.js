/* Render inert citation components without enabling HTML or executing refs expressions. */
(() => {
  "use strict";
  const { t } = globalThis.ChatGPTPdfI18n;
  const validRefs = (refs) => Array.isArray(refs) && refs.length > 0 && refs.length <= 100 &&
    refs.every((ref) => typeof ref === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(ref));

  function install(md) {
    md.inline.ruler.before("html_inline", "archive_citation", (state, silent) => {
      if (!state.src.startsWith("<cite", state.pos)) return false;
      const input = state.src.slice(state.pos, Math.min(state.posMax, state.pos + 14000));
      const match = /^<cite\s+refs\s*=\s*\{\s*(\[[\s\S]*?\])\s*\}\s*\/>/.exec(input);
      if (!match) return false;
      let refs;
      try { refs = JSON.parse(match[1]); } catch (_) { return false; }
      if (!validRefs(refs)) return false;
      if (!silent) state.push("archive_citation", "", 0).meta = { refs, insideLink: state.linkLevel > 0 };
      state.pos += match[0].length;
      return true;
    });
    // Old private-use citation markers are plain text to Markdown. Split only text
    // tokens after parsing so inline code and fenced code stay literal.
    md.core.ruler.after("inline", "archive_legacy_citations", (state) => {
      for (const block of state.tokens) {
        if (block.type !== "inline" || !block.children) continue;
        const children = [];
        let linkDepth = 0;
        for (const token of block.children) {
          if (token.type === "link_open") linkDepth++;
          else if (token.type === "link_close") linkDepth--;
          if (token.type !== "text") { children.push(token); continue; }
          let start = 0;
          for (const match of token.content.matchAll(/cite((?:[^]+)+)/g)) {
            const refs = match[1].split("").slice(1);
            if (!validRefs(refs)) continue;
            if (match.index > start) {
              const text = new state.Token("text", "", 0);
              text.content = token.content.slice(start, match.index);
              children.push(text);
            }
            const citation = new state.Token("archive_citation", "", 0);
            citation.meta = { refs, insideLink: linkDepth > 0 };
            children.push(citation);
            start = match.index + match[0].length;
          }
          if (start === 0) children.push(token);
          else if (start < token.content.length) {
            const text = new state.Token("text", "", 0);
            text.content = token.content.slice(start);
            children.push(text);
          }
        }
        block.children = children;
      }
    });
    md.renderer.rules.archive_citation = (tokens, index, options, env = {}) => {
      if (env.archiveHideCitations) return "";
      const id = env.archiveSourcesId;
      if (typeof id === "string" && /^sources-\d+$/.test(id)) {
        if (tokens[index].meta.insideLink) return `<span class="pdf-citation">[${md.utils.escapeHtml(t("sourcesLabel"))}]</span>`;
        return `<a class="pdf-citation" href="#${id}">[${md.utils.escapeHtml(t("sourcesLabel"))}]</a>`;
      }
      return `<span class="pdf-citation pdf-citation-unavailable">[${md.utils.escapeHtml(t("citationUnavailable"))}]</span>`;
    };
  }
  globalThis.ChatGPTPdfCitations = { install };
})();
