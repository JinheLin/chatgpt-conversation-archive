/* Convert the isolated, safe transcript to portable Markdown, without reader UI. */
(() => {
  "use strict";
  const { t, formatTimestamp } = globalThis.ChatGPTPdfI18n;
  const escape = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\`*_[\]{}()#+.!|$~\-]/g, "\\$&");
  const plain = value => escape(String(value).replace(/\s+/g, " ").trim());
  const block = value => value.trim() ? "\n\n" + value.trim() + "\n\n" : "";
  const longest = value => [...value.matchAll(/`+/g)].reduce((maximum, match) => Math.max(maximum, match[0].length), 0);

  function converter() {
    const references = new Map();
    function link(label, url, image = false) {
      if (!url) return label;
      // Angle destinations keep spaces and parentheses in URLs unambiguous.
      const destination = url.replace(/[<>\r\n]/g, char => encodeURIComponent(char));
      if (url.startsWith("data:")) {
        if (!references.has(destination)) references.set(destination, "asset-" + (references.size + 1));
        return `${image ? "!" : ""}[${label}][${references.get(destination)}]`;
      }
      return `${image ? "!" : ""}[${label}](<${destination}>)`;
    }
    function children(node) {
      let output = "";
      for (const child of node.childNodes) {
        const part = visit(child);
        const tail = output.match(/\n+$/)?.[0].length || 0;
        const head = part.match(/^\n+/)?.[0].length || 0;
        // Only merge boundaries; never rewrite whitespace inside code blocks.
        output = tail && head ? output.slice(0, -tail) + "\n".repeat(Math.max(tail, head)) + part.slice(head) : output + part;
      }
      return output;
    }
    function list(node) {
      const ordered = node.tagName === "OL" || node.classList.contains("archive-layout-marker-number");
      const start = Number(node.getAttribute("start")) || 1;
      return block([...node.children].filter(item => item.matches("li, [role=listitem]"))
        .map((item, index) => {
          const marker = ordered ? `${start + index}. ` : "- ";
          return children(item).trim().split("\n").map((line, i) => (i ? " ".repeat(marker.length) : marker) + line).join("\n");
        }).join("\n"));
    }
    function table(node) {
      const rows = [...node.querySelectorAll("tr, [role=row]")]
        .filter(row => row.closest("table, [role=table]") === node)
        .map(row => [...row.children].filter(cell => cell.matches("td, th, [role=cell], [role=columnheader]"))
          .map(cell => children(cell).trim().replace(/\n+/g, "<br>").replace(/(?<!\\)\|/g, "\\|")));
      if (!rows.length) return "";
      const width = Math.max(...rows.map(row => row.length));
      const line = row => "| " + Array.from({ length: width }, (_, index) => row[index] || "").join(" | ") + " |";
      return block([line(rows[0]), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n"));
    }
    function visit(node) {
      if (node.nodeType === 3) {
        if (/^\s*\n\s*$/.test(node.nodeValue) && !node.parentElement.matches("p, h1, h2, h3, h4, h5, h6, a, strong, em, span")) return "";
        return escape(node.nodeValue.replace(/\s+/g, " "));
      }
      if (node.nodeType !== 1 || node.matches("script, style, .pdf-citation, [aria-hidden=true]")) return "";
      const tag = node.tagName.toLowerCase();
      if (node.matches(".katex-display, .katex")) {
        const tex = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent || "";
        return node.classList.contains("katex-display") ? block("$$\n" + tex.trim() + "\n$$") : "$" + tex + "$";
      }
      if (tag === "pre") {
        const code = node.querySelector("code"), source = code?.textContent ?? node.textContent;
        const fence = "`".repeat(Math.max(3, longest(source) + 1));
        const language = code?.className.match(/(?:^|\s)language-([^\s`]+)/)?.[1] || "";
        return "\n\n" + fence + language + "\n" + source + (source.endsWith("\n") ? "" : "\n") + fence + "\n\n";
      }
      if (tag === "code") {
        const source = node.textContent.replace(/\n/g, " "), fence = "`".repeat(longest(source) + 1);
        const pad = /(^`|`$|^ .* $)/.test(source) && /[^ ]/.test(source) ? " " : "";
        return fence + pad + source + pad + fence;
      }
      if (tag === "svg") {
        const svg = node.cloneNode(true); svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        return block(new XMLSerializer().serializeToString(svg));
      }
      if (tag === "img") return link(plain(node.getAttribute("alt") || t("imageLabel")), node.getAttribute("src"), true);
      if (tag === "a") return link(children(node).trim(), node.getAttribute("href"));
      if (tag === "ol" || tag === "ul" || node.getAttribute("role") === "list") return list(node);
      if (tag === "table" || node.getAttribute("role") === "table") return table(node);
      if (node.matches(".archive-layout-checkbox, .archive-layout-radio")) {
        const checked = node.querySelector(".archive-control-mark")?.dataset.selected === "true";
        return block(`- [${checked ? "x" : " "}] ` + children(node).trim());
      }
      const content = children(node);
      if (/^h[1-6]$/.test(tag)) return block("#".repeat(Math.min(6, Number(tag[1]) + 2)) + " " + content.trim());
      if (tag === "strong" || tag === "b") return content.trim() ? "**" + content.trim() + "**" : "";
      if (tag === "em" || tag === "i") return content.trim() ? "*" + content.trim() + "*" : "";
      if (tag === "s" || tag === "del") return "~~" + content + "~~";
      if (tag === "br") return "  \n";
      if (tag === "hr") return block("---");
      if (tag === "blockquote") return block(content.trim().split("\n").map(line => "> " + line).join("\n"));
      if (node.classList.contains("archive-layout-title")) return block("**" + content.trim() + "**");
      if (["p", "div", "section", "figure", "figcaption", "details", "summary"].includes(tag)) return block(content);
      return content;
    }
    return { body: node => children(node).trim(), definitions() {
      return [...references].map(([url, id]) => `[${id}]: <${url}>`).join("\n");
    } };
  }

  async function create(payload, { firstQuestion = 1 } = {}) {
    const transcript = document.createElement("main");
    // Render afresh so hidden answers, local marks and controls cannot affect output.
    await globalThis.ChatGPTPdfExporter.render(payload, transcript);
    const markdown = converter(), parts = ["# " + plain(payload.title)];
    if (payload.sourceUrl) parts.push(`[${plain(t("originalLink"))}](<${payload.sourceUrl}>)`);
    let question = firstQuestion - 1;
    for (const [index, section] of [...transcript.querySelectorAll(":scope > .pdf-message")].entries()) {
      const message = payload.messages[index];
      const role = message.role === "user" ? t("questionLabel", ++question) : t("answerLabel");
      const time = typeof message.createdAt === "string" && Number.isFinite(Date.parse(message.createdAt))
        ? " · " + formatTimestamp(message.createdAt) : "";
      parts.push("## " + plain(role + time), markdown.body(section.querySelector(".pdf-message-body")));
    }
    parts.push(markdown.definitions());
    return parts.filter(Boolean).join("\n\n") + "\n";
  }
  globalThis.ChatGPTMarkdownExport = { create };
})();
