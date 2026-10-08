/* Render a small, inert subset of ChatGPT layout markup without enabling raw HTML. */
(() => {
  "use strict";
  const layoutNames = new Set(["box", "grid", "grid-item", "row", "text", "caption", "title", "badge", "icon", "divider"]);
  const svgNames = new Set(["svg", "g", "rect", "circle", "ellipse", "line", "path", "polygon", "polyline", "text", "tspan"]);
  const names = new Set([...layoutNames, ...svgNames]);
  const MAX_DEPTH = 32;
  const MAX_NODES = 2000;

  function readTag(source, start) {
    const match = /^<(\/?)([a-z][a-z-]*)\b/.exec(source.slice(start));
    if (!match || !names.has(match[2])) return null;
    let pos = start + match[0].length;
    const attrs = Object.create(null);
    const expressions = [];
    while (pos < source.length) {
      const tail = source.slice(pos);
      const close = /^\s*(\/?)>/.exec(tail);
      if (close) return { name: match[2], closing: !!match[1], selfClosing: !!close[1], attrs, expressions, end: pos + close[0].length };
      if (match[1]) return null;
      const attr = /^\s+([a-zA-Z][a-zA-Z0-9-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^{}]*)\}))?(?=\s|\/?>)/.exec(tail);
      if (!attr) return null;
      attrs[attr[1]] = attr[2] ?? attr[3] ?? attr[4]?.trim() ?? "true";
      if (attr[4] !== undefined) expressions.push(attr[1]);
      pos += attr[0].length;
    }
    return null;
  }

  // A data-only expression grammar: numbers, strings, loop variables, arithmetic,
  // comparisons and ternaries. No calls, property access, assignment or JS evaluation.
  function valueOf(source, scope) {
    if (source.length > 1000) return null;
    const tokens = [];
    let pos = 0, cursor = 0;
    while (pos < source.length) {
      if (/\s/.test(source[pos])) { pos++; continue; }
      const token = /^(?:\d+(?:\.\d+)?|\.\d+|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[a-zA-Z_]\w*|===|!==|==|!=|<=|>=|[+*/<>()?\[\]:!-])/.exec(source.slice(pos));
      if (!token) return null;
      tokens.push(token[0]); pos += token[0].length;
    }
    const precedence = { "===": 1, "!==": 1, "==": 1, "!=": 1, "<": 2, ">": 2, "<=": 2, ">=": 2, "+": 3, "-": 3, "*": 4, "/": 4 };
    function expression(min = 0, depth = 0) {
      if (depth > MAX_DEPTH) throw new Error("Expression nesting limit");
      const token = tokens[cursor++];
      let value;
      if (["-", "+", "!"].includes(token)) {
        const operand = expression(5, depth + 1);
        if (token !== "!" && typeof operand !== "number") throw new Error("Numeric operand required");
        value = token === "!" ? !operand : token === "-" ? -operand : operand;
      } else if (token === "(") {
        value = expression(0, depth + 1);
        if (tokens[cursor++] !== ")") throw new Error("Missing parenthesis");
      } else if (/^(?:\d|\.\d)/.test(token || "")) value = Number(token);
      else if (token?.startsWith('"')) value = JSON.parse(token);
      else if (token?.startsWith("'")) value = token.slice(1, -1).replace(/\\(['\\])/g, "$1");
      else if (token === "true" || token === "false") value = token === "true";
      else if (token === "undefined") value = undefined;
      else if (token === "null") value = null;
      else if (Object.hasOwn(scope, token)) value = scope[token];
      else throw new Error("Unknown value");
      while (tokens[cursor] === "[") {
        cursor++;
        const index = expression(0, depth + 1);
        if (tokens[cursor++] !== "]" || !Array.isArray(value) || !Number.isInteger(index) || index < 0) throw new Error("Invalid index");
        value = value[index];
      }
      while ((precedence[tokens[cursor]] || 0) > min) {
        const op = tokens[cursor++], right = expression(precedence[op], depth + 1);
        if (["+", "-", "*", "/"].includes(op)) {
          if (typeof value !== "number" || typeof right !== "number") throw new Error("Numeric operands required");
          value = op === "+" ? value + right : op === "-" ? value - right : op === "*" ? value * right : value / right;
        } else value = op === "<" ? value < right : op === ">" ? value > right : op === "<=" ? value <= right : op === ">=" ? value >= right :
          ["===", "=="].includes(op) ? value === right : value !== right;
      }
      if (min === 0 && tokens[cursor] === "?") {
        cursor++;
        const yes = expression(0, depth + 1);
        if (tokens[cursor++] !== ":") throw new Error("Missing ternary branch");
        const no = expression(0, depth + 1);
        value = value ? yes : no;
      }
      return value;
    }
    try {
      const value = expression();
      if (cursor !== tokens.length || (typeof value === "number" && !Number.isFinite(value))) return null;
      return { value };
    } catch (_) { return null; }
  }

  function parse(source, start) {
    let count = 0;
    function nodeAt(pos, depth, inSvg = false) {
      if (depth > MAX_DEPTH || ++count > MAX_NODES) return null;
      const open = readTag(source, pos);
      if (!open || open.closing) return null;
      if (inSvg ? !svgNames.has(open.name) : !layoutNames.has(open.name) && open.name !== "svg") return null;
      const node = { ...open, svg: inSvg || open.name === "svg", children: [] };
      if (open.selfClosing) return node;
      const content = childrenAt(open.end, depth, node.svg, open.name);
      if (!content) return null;
      return { ...node, ...content };
    }
    function loopAt(pos, depth, inSvg) {
      if (depth > MAX_DEPTH || ++count > MAX_NODES) return null;
      const open = /^\{#each\s+([\s\S]*?)\s+as\s+([a-zA-Z_]\w*)(?:\s*,\s*([a-zA-Z_]\w*))?\s*\}/.exec(source.slice(pos));
      if (!open) return null;
      let items;
      try { items = JSON.parse(open[1]); } catch (_) { return null; }
      const literal = (value, depth = 0) => depth < 8 && (value === null || ["string", "number", "boolean"].includes(typeof value) ||
        Array.isArray(value) && value.length <= 200 && value.every(item => literal(item, depth + 1)));
      if (!Array.isArray(items) || !literal(items)) return null;
      const content = childrenAt(pos + open[0].length, depth, inSvg, "each");
      return content && { name: "each", svg: inSvg, items, variable: open[2], index: open[3], ...content };
    }
    function childrenAt(pos, depth, inSvg, closing) {
      let cursor = pos, textStart = cursor;
      const children = [];
      while (cursor < source.length) {
        // Layout examples inside Markdown code and escaped tags remain literal.
        if (source[cursor] === "\\") { cursor += 2; continue; }
        const code = (source[cursor] === "`" || source[cursor] === "~") && /^(`+|~{3,})/.exec(source.slice(cursor));
        if (code) {
          const marker = code[1];
          let close = source.indexOf(marker, cursor + marker.length);
          while (close >= 0 && (source[close - 1] === marker[0] || source[close + marker.length] === marker[0])) {
            close = source.indexOf(marker, close + marker.length);
          }
          if (close >= 0) { cursor = close + marker.length; continue; }
        }
        if (source.startsWith("{/each}", cursor)) {
          if (closing !== "each") return null;
          children.push(source.slice(textStart, cursor));
          return { children, end: cursor + 7 };
        }
        if (source.startsWith("{#each", cursor)) {
          const loop = loopAt(cursor, depth + 1, inSvg);
          if (!loop) return null;
          children.push(source.slice(textStart, cursor), loop);
          cursor = textStart = loop.end;
          continue;
        }
        if (source[cursor] !== "<") { cursor++; continue; }
        const tag = readTag(source, cursor);
        if (!tag) { cursor++; continue; }
        if (tag.closing) {
          if (tag.name !== closing || tag.selfClosing) return null;
          children.push(source.slice(textStart, cursor));
          return { children, end: tag.end };
        }
        const child = nodeAt(cursor, depth + 1, inSvg);
        if (!child) return null;
        children.push(source.slice(textStart, cursor), child);
        cursor = textStart = child.end;
      }
      return null;
    }
    const node = nodeAt(start, 0);
    if (node) node.source = source.slice(start, node.end);
    return node;
  }

  function safeColor(value) {
    if (/^(?:#[\da-f]{3,8}|currentColor|none|transparent|black|white)$/i.test(value || "")) return value;
    const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?))?\s*\)$/.exec(value || "");
    return rgb && rgb.slice(1, 4).every(channel => Number(channel) <= 255) ? value : null;
  }

  function presentation(node, attrs) {
    const classes = ["archive-layout", `archive-layout-${node.name}`];
    const styles = [];
    if (attrs.border === "true") classes.push("archive-layout-border");
    if (attrs.background === "surface-secondary") classes.push("archive-layout-surface-secondary");
    else if (safeColor(attrs.background)) styles.push(`background-color:${safeColor(attrs.background)}`);
    if (["secondary", "tertiary"].includes(attrs.color)) classes.push("archive-layout-secondary");
    else if (safeColor(attrs.color)) styles.push(`color:${safeColor(attrs.color)}`);
    const choices = {
      radius: { none: "0", sm: "4px", md: "6px", lg: "8px", xl: "12px" },
      align: { left: "left", start: "left", center: "center", right: "right", end: "right" },
      weight: { normal: "400", regular: "400", medium: "500", semibold: "600", bold: "700" },
      size: { xs: ".8rem", sm: ".9rem", md: "1rem", lg: "1.125rem", xl: "1.25rem" }
    };
    const properties = { radius: "border-radius", align: "text-align", weight: "font-weight", size: "font-size" };
    for (const [key, values] of Object.entries(choices)) {
      if (Object.hasOwn(values, attrs[key])) styles.push(`${properties[key]}:${values[attrs[key]]}`);
    }
    if (Object.hasOwn(choices.align, attrs.textAlign)) styles.push(`text-align:${choices.align[attrs.textAlign]}`);
    if (node.name === "row") {
      const align = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };
      const justify = { start: "flex-start", center: "center", end: "flex-end", between: "space-between", around: "space-around" };
      if (Object.hasOwn(align, attrs.align)) styles.push(`align-items:${align[attrs.align]}`);
      if (Object.hasOwn(justify, attrs.justify)) styles.push(`justify-content:${justify[attrs.justify]}`);
    }
    if (/^[0-6]$/.test(attrs.flex)) styles.push(`flex:${attrs.flex} 1 0`);
    if (/^\d{1,4}$/.test(attrs.width) && Number(attrs.width) <= 2000) styles.push(`width:${attrs.width}px`);
    if (attrs.width === "100%") styles.push("width:100%");
    if (attrs.tabularNums === "true") styles.push("font-variant-numeric:tabular-nums");
    for (const key of ["padding", "gap"]) {
      if (/^\d{1,2}$/.test(attrs[key]) && Number(attrs[key]) <= 12) {
        styles.push(`--archive-layout-${key}:${Number(attrs[key]) * 4}px`);
      }
    }
    if (/^[1-6]$/.test(attrs.columns)) styles.push(`--archive-layout-columns:${attrs.columns}`);
    return `class="${classes.join(" ")}"${styles.length ? ` style="${styles.join(";")}"` : ""}`;
  }

  const escape = source => String(source).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  function svgPresentation(node, attrs) {
    const aliases = { fontSize: "font-size", fontWeight: "font-weight", textAnchor: "text-anchor", strokeWidth: "stroke-width",
      strokeDasharray: "stroke-dasharray", fillOpacity: "fill-opacity", strokeOpacity: "stroke-opacity" };
    const numeric = new Set(["x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "dx", "dy", "font-size", "stroke-width", "opacity", "fill-opacity", "stroke-opacity"]);
    const output = [];
    for (const [key, value] of Object.entries(attrs)) {
      const name = aliases[key] || key;
      let valid = false;
      if (numeric.has(name)) valid = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) && Math.abs(Number(value)) <= 10000;
      else if (["width", "height"].includes(name)) valid = /^(?:\d+(?:\.\d+)?)(?:%)?$/.test(value) && parseFloat(value) <= 10000;
      else if (name === "viewBox") valid = /^-?[\d.]+(?:[ ,]+-?[\d.]+){3}$/.test(value) && value.split(/[ ,]+/).every(n => Number.isFinite(Number(n)) && Math.abs(Number(n)) <= 10000);
      else if (["fill", "stroke"].includes(name)) valid = !!safeColor(value);
      else if (name === "d") valid = value.length <= 100000 && /^[MmLlHhVvCcSsQqTtAaZzEe\d+.,\s-]+$/.test(value);
      else if (["points", "stroke-dasharray"].includes(name)) valid = /^[\d+.,\s-]+$/.test(value);
      else if (name === "text-anchor") valid = ["start", "middle", "end"].includes(value);
      else if (name === "font-weight") valid = /^(?:normal|bold|[1-9]00)$/.test(value);
      else if (name === "transform") valid = /^(?:(?:translate|scale|rotate|matrix|skewX|skewY)\([\d+.,\s-]+\)\s*)+$/.test(value);
      if (valid) output.push(`${name}="${escape(value)}"`);
    }
    if (node.name === "svg") output.push('xmlns="http://www.w3.org/2000/svg" class="archive-layout-svg" role="img"');
    return output.join(" ");
  }

  function dedent(source) {
    const lines = source.split("\n");
    const content = lines.filter(line => line.trim());
    const indent = content.length ? Math.min(...content.map(line => /^ */.exec(line)[0].length)) : 0;
    return lines.map(line => line.slice(Math.min(indent, /^ */.exec(line)[0].length))).join("\n");
  }

  function install(md) {
    function renderNode(node, env, inline, scope = Object.create(null), budget = { left: MAX_NODES }) {
      if (--budget.left < 0) throw new Error("Layout expansion limit");
      if (node.name === "each") {
        return node.items.map((item, index) => {
          const local = Object.assign(Object.create(null), scope, { [node.variable]: item });
          if (node.index) local[node.index] = index;
          return children(node, env, inline, local, budget);
        }).join("");
      }
      const attrs = { ...node.attrs };
      for (const key of node.expressions) {
        const result = valueOf(attrs[key], scope);
        if (!result || result.value === undefined || result.value === null) delete attrs[key];
        else attrs[key] = String(result.value);
      }
      if (node.svg) return `<${node.name} ${svgPresentation(node, attrs)}>${children(node, env, inline, scope, budget)}</${node.name}>`;
      const tag = inline ? "span" : "div";
      if (node.name === "icon") {
        const symbols = { "arrow-down": "↓", "arrow-up": "↑", "arrow-right": "→", "arrow-left": "←", check: "✓" };
        return `<${tag} ${presentation(node, attrs)}>${Object.hasOwn(symbols, attrs.name) ? symbols[attrs.name] : ""}</${tag}>`;
      }
      return `<${tag} ${presentation(node, attrs)}>${children(node, env, inline, scope, budget)}</${tag}>`;
    }
    function children(node, env, inline, scope, budget) {
      const inlineContent = inline || ["text", "caption", "title", "badge"].includes(node.name);
      return node.children.map(child => {
        if (typeof child !== "string") return renderNode(child, env, inline, scope, budget);
        if (!node.svg && !child.trim()) return "";
        // Substitute only scoped loop data, escaped before Markdown or SVG rendering.
        const source = node.svg ? md.utils.unescapeAll(child) : child;
        const text = source.replace(/\{([^{}\n]+)\}/g, (original, expression) => {
          const result = Object.keys(scope).length && valueOf(expression, scope);
          if (!result || !["string", "number", "boolean"].includes(typeof result.value)) return original;
          return node.svg ? String(result.value) : escape(result.value).replace(/[\\`*_[\]{}()!#$~|]/g, "\\$&");
        });
        if (node.svg) return escape(text);
        return inlineContent ? md.renderInline(text.includes("\n") ? dedent(text) : text, env) : md.render(dedent(text), env);
      }).join("");
    }
    md.block.ruler.before("fence", "archive_layout_block", (state, start, end, silent) => {
      if (state.sCount[start] - state.blkIndent >= 4) return false;
      const offset = state.bMarks[start] + state.tShift[start];
      if (state.src[offset] !== "<") return false;
      const node = parse(state.src.slice(0, state.eMarks[end - 1]), offset);
      if (!node) return false;
      let last = start;
      while (last < end && state.eMarks[last] < node.end) last++;
      if (last >= end || state.src.slice(node.end, state.eMarks[last]).trim()) return false;
      if (!silent) {
        const token = state.push("archive_layout", "", 0);
        token.block = true;
        token.map = [start, last + 1];
        token.meta = { node, inline: false };
        state.line = last + 1;
      }
      return true;
    }, { alt: ["paragraph", "reference", "blockquote", "list"] });
    md.inline.ruler.before("html_inline", "archive_layout_inline", (state, silent) => {
      if (state.src[state.pos] !== "<") return false;
      const node = parse(state.src.slice(0, state.posMax), state.pos);
      if (!node) return false;
      if (!silent) state.push("archive_layout", "", 0).meta = { node, inline: true };
      state.pos = node.end;
      return true;
    });
    md.renderer.rules.archive_layout = (tokens, index, options, env) => {
      const { node, inline } = tokens[index].meta;
      try { return renderNode(node, env, inline) + (inline ? "" : "\n"); }
      catch (_) { return inline ? `<code>${escape(node.source)}</code>` : `<pre><code>${escape(node.source)}</code></pre>\n`; }
    };
  }

  globalThis.ChatGPTArchiveLayout = { install };
})();
