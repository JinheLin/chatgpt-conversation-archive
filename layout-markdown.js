/* Render a small, inert subset of ChatGPT layout markup without enabling raw HTML. */
(() => {
  "use strict";
  const layoutNames = new Set(["box", "grid", "grid-item", "row", "text", "caption", "title", "badge", "icon", "divider",
    "table", "table-row", "table-cell", "list", "list-item", "link", "chart", "entity", "asyncimage",
    "form", "checkbox", "radio-group", "radio", "textarea", "button"]);
  const svgNames = new Set(["svg", "g", "rect", "circle", "ellipse", "line", "path", "polygon", "polyline", "text", "tspan"]);
  const names = new Set([...layoutNames, ...svgNames]);
  const MAX_DEPTH = 32;
  const MAX_NODES = 2000;
  const forbiddenFields = new Set(["__proto__", "prototype", "constructor"]);

  // Parse array/object data with quoted or bare keys. This is a literal reader,
  // not JavaScript: calls, spreads, getters and computed keys are never accepted.
  function literalData(source, start) {
    let pos = start, count = 0;
    const end = Math.min(source.length, start + 100000);
    const whitespace = () => { while (pos < end && /\s/.test(source[pos])) pos++; };
    function string() {
      const quote = source[pos++];
      let value = "";
      const escapes = { '"': '"', "'": "'", "\\": "\\", "/": "/", n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
      while (pos < end) {
        const char = source[pos++];
        if (char === quote) return value;
        if (char.charCodeAt(0) < 32) throw new Error("Invalid literal string");
        if (char !== "\\") { value += char; continue; }
        const escape = source[pos++];
        if (Object.hasOwn(escapes, escape)) value += escapes[escape];
        else if (escape === "u" && pos + 4 <= end && /^[\da-f]{4}$/i.test(source.slice(pos, pos + 4))) {
          value += String.fromCharCode(parseInt(source.slice(pos, pos + 4), 16)); pos += 4;
        } else throw new Error("Invalid literal escape");
      }
      throw new Error("Unclosed literal string");
    }
    function literal(depth = 0) {
      if (depth >= 8 || ++count > MAX_NODES) throw new Error("Literal data limit");
      whitespace();
      if (pos >= end) throw new Error("Literal input limit");
      const char = source[pos];
      if (char === '"' || char === "'") return string();
      if (char === "[" || char === "{") {
        pos++;
        const array = char === "[", close = array ? "]" : "}";
        const value = array ? [] : Object.create(null);
        let length = 0;
        whitespace();
        if (pos >= end) throw new Error("Unclosed literal collection");
        while (source[pos] !== close) {
          if (pos >= end || ++length > (array ? 200 : 50)) throw new Error("Literal collection limit");
          if (array) value.push(literal(depth + 1));
          else {
            let key;
            if (source[pos] === '"' || source[pos] === "'") key = string();
            else {
              const match = /^[a-zA-Z_]\w*/.exec(source.slice(pos, end));
              if (!match) throw new Error("Invalid literal key");
              key = match[0]; pos += key.length;
            }
            if (key.length > 128 || forbiddenFields.has(key) || Object.hasOwn(value, key)) throw new Error("Invalid literal field");
            whitespace();
            if (source[pos++] !== ":") throw new Error("Missing literal field value");
            value[key] = literal(depth + 1);
          }
          whitespace();
          if (pos >= end) throw new Error("Unclosed literal collection");
          if (source[pos] === close) break;
          if (source[pos++] !== ",") throw new Error("Missing literal separator");
          whitespace();
          if (pos >= end) throw new Error("Unclosed literal collection");
        }
        pos++;
        return value;
      }
      const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(pos, end));
      if (!token) throw new Error("Invalid literal value");
      pos += token[0].length;
      const value = JSON.parse(token[0]);
      if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Invalid literal number");
      return value;
    }
    try {
      return { value: literal(), end: pos };
    } catch (_) { return null; }
  }

  function loopItems(source, start) {
    const data = literalData(source, start);
    if (data && Array.isArray(data.value)) return { items: data.value, end: data.end };
    // Recognize only this bounded identity range syntax, never execute a call.
    const range = /^Array\.from\(\s*\{\s*length\s*:\s*(\d{1,3})\s*\}\s*,\s*\(\s*_\s*,\s*([a-zA-Z_]\w*)\s*\)\s*=>\s*\2\s*\)/.exec(source.slice(start));
    if (!range || Number(range[1]) > 200) return null;
    return { items: Array.from({ length: Number(range[1]) }, (_, index) => index), end: start + range[0].length };
  }

  function bracedValue(source, start) {
    let depth = 0, quote = null;
    for (let pos = start; pos < Math.min(source.length, start + 100000); pos++) {
      const char = source[pos];
      if (quote) {
        if (char === "\\") pos++;
        else if (char === quote) quote = null;
      } else if (char === '"' || char === "'") quote = char;
      else if (char === "{") { if (++depth > MAX_DEPTH) return null; }
      else if (char === "}" && --depth === 0) return { content: source.slice(start + 1, pos), end: pos + 1 };
    }
    return null;
  }

  function readBinding(source, start) {
    if (!source.startsWith("{@body", start)) return null;
    const body = bracedValue(source, start);
    if (!body) return null;
    const declaration = /^@body\s+const\s+(?:([a-zA-Z_]\w*)\s*=\s*|\[\s*([a-zA-Z_]\w*)\s*,\s*[a-zA-Z_]\w*\s*\]\s*=\s*DIL\.useState\(\s*)/.exec(body.content);
    if (!declaration) return null;
    const binding = declaration[1] || declaration[2];
    if (binding.length > 128 || forbiddenFields.has(binding)) return null;
    const data = literalData(body.content, declaration[0].length);
    const tail = data && body.content.slice(data.end);
    if (!data || !(declaration[1] ? /^\s*;?\s*$/ : /^\s*\)\s*;?\s*$/).test(tail)) return null;
    // Only literal initialization is read. DIL and setters are never called.
    return { name: "binding", binding, value: data.value, end: body.end, children: [] };
  }

  function readTag(source, start) {
    const match = /^<(\/?)([a-z][a-z-]*)\b/i.exec(source.slice(start));
    const name = match?.[2].toLowerCase();
    if (!match || !names.has(name)) return null;
    let pos = start + match[0].length;
    const attrs = Object.create(null);
    const expressions = [];
    while (pos < source.length) {
      const tail = source.slice(pos);
      const close = /^\s*(\/?)>/.exec(tail);
      if (close) return { name, closing: !!match[1], selfClosing: !!close[1], attrs, expressions, end: pos + close[0].length };
      if (match[1]) return null;
      const attr = /^\s+([a-zA-Z][a-zA-Z0-9-]*)(\s*=\s*)?/.exec(tail);
      if (!attr) return null;
      pos += attr[0].length;
      let value = "true";
      if (attr[2]) {
        if (source[pos] === "{") {
          const expression = bracedValue(source, pos);
          if (!expression) return null;
          value = expression.content.trim(); pos = expression.end;
          expressions.push(attr[1]);
        } else {
          // Unquoted static tokens, such as align=start or radius=lg, are
          // literals too. Presentation still accepts only its fixed values.
          const literal = /^(?:"([^"]*)"|'([^']*)'|([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:px|%)?|[a-zA-Z_][a-zA-Z0-9_.:-]*))/.exec(source.slice(pos));
          if (!literal) return null;
          value = literal[1] ?? literal[2] ?? literal[3]; pos += literal[0].length;
        }
      }
      if (!/^(?:\s|\/?>)/.test(source.slice(pos)) || Object.hasOwn(attrs, attr[1])) return null;
      attrs[attr[1]] = value;
    }
    return null;
  }

  function readEscape(source, start) {
    if (!/^<escape\b/i.test(source.slice(start, start + 8))) return null;
    const input = source.slice(start, start + 10000);
    const open = /^<escape\s*>/i.exec(input);
    if (!open) return null;
    const close = /<\/escape\s*>/i.exec(input.slice(open[0].length));
    return close && { content: input.slice(open[0].length, open[0].length + close.index),
      end: start + open[0].length + close.index + close[0].length };
  }

  // A data-only expression grammar: numbers, strings, loop data, arithmetic,
  // comparisons and ternaries. Only own literal fields and array indexes can be
  // read, plus membership, bounded slices and single character-code conversion;
  // no arbitrary calls, prototype access, assignment or JavaScript evaluation.
  function valueOf(source, scope) {
    if (source.length > 1000) return null;
    const tokens = [];
    let pos = 0, cursor = 0;
    while (pos < source.length) {
      if (/\s/.test(source[pos])) { pos++; continue; }
      if (source[pos] === "[" && (!tokens.length || /^(?:\(|,|\?|:|===|!==|==|!=|<=|>=|[+*/%<>!\-])$/.test(tokens.at(-1)))) {
        const data = literalData(source, pos);
        if (!data || !Array.isArray(data.value)) return null;
        tokens.push({ literal: data.value }); pos = data.end; continue;
      }
      const token = /^(?:\d+(?:\.\d+)?|\.\d+|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[a-zA-Z_]\w*|===|!==|==|!=|<=|>=|&&|\|\||[+*/%<>()?,\[\]:!.\-])/.exec(source.slice(pos));
      if (!token) return null;
      tokens.push(token[0]); pos += token[0].length;
    }
    const precedence = { "||": 1, "&&": 2, "===": 3, "!==": 3, "==": 3, "!=": 3, "<": 4, ">": 4, "<=": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };
    function expression(min = 0, depth = 0) {
      if (depth > MAX_DEPTH) throw new Error("Expression nesting limit");
      const token = tokens[cursor++];
      let value;
      if (token && typeof token === "object") value = token.literal;
      else if (["-", "+", "!"].includes(token)) {
        const operand = expression(7, depth + 1);
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
      else if (token === "String" && tokens[cursor] === "." && tokens[cursor + 1] === "fromCharCode" && tokens[cursor + 2] === "(") {
        cursor += 3;
        const code = expression(0, depth + 1);
        if (tokens[cursor++] !== ")" || !Number.isInteger(code) || code < 0 || code > 65535) throw new Error("Invalid character code");
        // Interpret this one data transform ourselves. Never resolve String or
        // invoke a function supplied by the conversation or its literal scope.
        value = String.fromCharCode(code);
      }
      else if (Object.hasOwn(scope, token)) value = scope[token];
      else throw new Error("Unknown value");
      while (["[", "."].includes(tokens[cursor])) {
        const access = tokens[cursor++];
        const key = access === "." ? tokens[cursor++] : expression(0, depth + 1);
        if (access === "." && key === "length" && (Array.isArray(value) || typeof value === "string")) {
          value = value.length; continue;
        }
        // Copy a bounded range from already-parsed data. Only integer indexes
        // are accepted; callbacks and methods supplied by the source never run.
        if (access === "." && key === "slice" && Array.isArray(value) && tokens[cursor] === "(") {
          if (value.length > 200) throw new Error("Array slice limit");
          cursor++;
          const indexes = [];
          if (tokens[cursor] !== ")") {
            indexes.push(expression(0, depth + 1));
            if (tokens[cursor] === ",") { cursor++; indexes.push(expression(0, depth + 1)); }
          }
          if (tokens[cursor++] !== ")" || !indexes.every(index => Number.isSafeInteger(index) && Math.abs(index) <= 1000000)) {
            throw new Error("Invalid literal slice");
          }
          value = value.slice(...indexes); continue;
        }
        // Membership in literal arrays, not arbitrary method calls.
        if (access === "." && key === "includes" && Array.isArray(value) && tokens[cursor] === "(") {
          cursor++;
          const needle = expression(0, depth + 1);
          if (tokens[cursor++] !== ")" || !value.every(item => item === null || ["string", "number", "boolean"].includes(typeof item))) {
            throw new Error("Invalid literal membership test");
          }
          value = value.includes(needle); continue;
        }
        if (access === "[" && tokens[cursor++] !== "]") throw new Error("Invalid index");
        const valid = Array.isArray(value) ? access === "[" && Number.isInteger(key) && key >= 0 :
          value && typeof value === "object" && typeof key === "string" && /^[a-zA-Z_]\w*$/.test(key) && !forbiddenFields.has(key);
        if (!valid || !Object.hasOwn(value, key)) throw new Error("Invalid data field");
        value = value[key];
      }
      while ((precedence[tokens[cursor]] || 0) > min) {
        const op = tokens[cursor++], right = expression(precedence[op], depth + 1);
        if (["+", "-", "*", "/", "%"].includes(op)) {
          if (typeof value !== "number" || typeof right !== "number") throw new Error("Numeric operands required");
          value = op === "+" ? value + right : op === "-" ? value - right : op === "*" ? value * right : op === "/" ? value / right : value % right;
          if (!Number.isFinite(value)) throw new Error("Non-finite arithmetic");
        } else if (op === "&&" || op === "||") value = op === "&&" ? value && right : value || right;
        else value = op === "<" ? value < right : op === ">" ? value > right : op === "<=" ? value <= right : op === ">=" ? value >= right :
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
      if (["entity", "asyncimage"].includes(open.name) && !open.selfClosing) return null;
      if (inSvg ? !svgNames.has(open.name) : !layoutNames.has(open.name) && open.name !== "svg") return null;
      const node = { ...open, svg: inSvg || open.name === "svg", children: [] };
      if (open.selfClosing) return node;
      const content = childrenAt(open.end, depth, node.svg, open.name);
      if (!content) return null;
      return { ...node, ...content };
    }
    function loopAt(pos, depth, inSvg) {
      if (depth > MAX_DEPTH || ++count > MAX_NODES) return null;
      const open = /^\{#each\s+/.exec(source.slice(pos));
      if (!open) return null;
      const data = loopItems(source, pos + open[0].length);
      const binding = data && /^\s+as\s+([a-zA-Z_]\w*)(?:\s*,\s*([a-zA-Z_]\w*))?\s*\}/.exec(source.slice(data.end));
      // The expression is interpreted by valueOf at render time. Capturing it
      // here does not execute calls or allow access outside the literal scope.
      const header = !binding && /^([^{}\n]{1,1000}?)\s+as\s+([a-zA-Z_]\w*)(?:\s*,\s*([a-zA-Z_]\w*))?\s*\}/.exec(source.slice(pos + open[0].length));
      if (!binding && !header) return null;
      const end = binding ? data.end + binding[0].length : pos + open[0].length + header[0].length;
      const content = childrenAt(end, depth, inSvg, "each");
      return content && { name: "each", svg: inSvg, items: binding ? data.items : undefined,
        reference: header?.[1], variable: binding ? binding[1] : header[2], index: binding ? binding[2] : header[3], ...content };
    }
    function childrenAt(pos, depth, inSvg, closing) {
      let cursor = pos, textStart = cursor;
      const children = [];
      while (cursor < source.length) {
        // Layout examples inside Markdown code and escaped tags remain literal.
        if (source[cursor] === "\\") { cursor += 2; continue; }
        const escaped = readEscape(source, cursor);
        if (escaped) { cursor = escaped.end; continue; }
        const code = (source[cursor] === "`" || source[cursor] === "~") && /^(`+|~{3,})/.exec(source.slice(cursor));
        if (code) {
          const marker = code[1];
          let close = source.indexOf(marker, cursor + marker.length);
          while (close >= 0 && (source[close - 1] === marker[0] || source[close + marker.length] === marker[0])) {
            close = source.indexOf(marker, close + marker.length);
          }
          if (close >= 0) { cursor = close + marker.length; continue; }
        }
        const initializer = readBinding(source, cursor);
        if (initializer) {
          if (++count > MAX_NODES) return null;
          children.push(source.slice(textStart, cursor), initializer);
          cursor = textStart = initializer.end; continue;
        }
        if (source.startsWith("{/if}", cursor)) {
          if (closing !== "if") return null;
          children.push(source.slice(textStart, cursor));
          return { children, end: cursor + 5 };
        }
        const condition = /^\{#if\s+([^{}\n]{1,1000})\}/.exec(source.slice(cursor));
        if (condition) {
          if (depth >= MAX_DEPTH || ++count > MAX_NODES) return null;
          const content = childrenAt(cursor + condition[0].length, depth + 1, inSvg, "if");
          if (!content) return null;
          children.push(source.slice(textStart, cursor), { name: "if", svg: inSvg, expression: condition[1], ...content });
          cursor = textStart = content.end; continue;
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
    // Structural children stay inside their table or list, including through
    // loops. Avoid emitting malformed HTML that the browser silently repairs.
    function validStructure(node, parent = null) {
      if (node.name === "if") node.containerContext = ["table", "table-row", "list"].includes(parent);
      if (parent === "table" && !["table-row", "each", "if", "binding"].includes(node.name) ||
          parent === "table-row" && !["table-cell", "each", "if", "binding"].includes(node.name) ||
          parent === "list" && !["list-item", "each", "if", "binding"].includes(node.name) ||
          node.name === "table-row" && parent !== "table" || node.name === "table-cell" && parent !== "table-row" ||
          node.name === "list-item" && parent !== "list") return false;
      const context = ["each", "if"].includes(node.name) ? parent : ["table", "table-row", "list"].includes(node.name) ? node.name : null;
      return node.children.every(child => typeof child === "string" ? !context || !child.trim() : validStructure(child, context));
    }
    if (node && !validStructure(node)) return null;
    if (node) node.source = source.slice(start, node.end);
    return node;
  }

  function safeColor(value) {
    if (/^(?:#[\da-f]{3,8}|currentColor|none|transparent|black|white)$/i.test(value || "")) return value;
    const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?))?\s*\)$/.exec(value || "");
    return rgb && rgb.slice(1, 4).every(channel => Number(channel) <= 255) ? value : null;
  }

  function imagePixels(value, minimum = 1) {
    const match = /^(\d{1,3})(?:px)?$/.exec(value || "");
    const pixels = match && Number(match[1]);
    return pixels >= minimum && pixels <= 500 ? pixels : null;
  }

  function presentation(node, attrs) {
    const classes = ["archive-layout", `archive-layout-${node.name}`];
    if (node.name === "list") {
      classes.push(`archive-layout-marker-${["number", "none"].includes(attrs.marker) ? attrs.marker : "bullet"}`);
      if (["solid", "dashed", "dotted"].includes(attrs.connector)) classes.push(`archive-layout-connector-${attrs.connector}`);
    }
    if (node.name === "icon" && attrs.inline === "true") classes.push("archive-layout-inline");
    const styles = [];
    if (attrs.border === "true") classes.push("archive-layout-border");
    if (node.name === "button" && attrs.variant === "outline") classes.push("archive-layout-outline");
    if (node.name === "row" && /^\d{1,4}(?:px)?$/.test(attrs.height) && parseFloat(attrs.height) <= 2000) {
      classes.push("archive-layout-sized-row");
    }
    if (node.name === "box" && attrs.clip === "true" && attrs.radius === "full" &&
        /^\d(?:px)?$/.test(attrs.height) && parseFloat(attrs.height) <= 8) classes.push("archive-layout-progress-track");
    if (attrs.background === "surface-secondary") classes.push("archive-layout-surface-secondary");
    else if (attrs.background === "surface-tertiary") classes.push("archive-layout-surface-tertiary");
    else if (safeColor(attrs.background)) styles.push(`background-color:${safeColor(attrs.background)}`);
    if (["secondary", "tertiary"].includes(attrs.color)) classes.push("archive-layout-secondary");
    else if (safeColor(attrs.color)) styles.push(`color:${safeColor(attrs.color)}`);
    const choices = {
      radius: { none: "0", "2xs": "1px", xs: "2px", sm: "4px", md: "6px", lg: "8px", xl: "12px", full: "9999px" },
      align: { left: "left", start: "left", center: "center", right: "right", end: "right" },
      weight: { normal: "400", regular: "400", medium: "500", semibold: "600", bold: "700" },
      size: { "3xs": ".65rem", "2xs": ".7rem", xs: ".8rem", sm: ".9rem", md: "1rem", lg: "1.125rem", xl: "1.25rem", "2xl": "1.5rem" }
    };
    const properties = { radius: "border-radius", align: "text-align", weight: "font-weight", size: "font-size" };
    for (const [key, values] of Object.entries(choices)) {
      if (typeof attrs[key] === "string" && Object.hasOwn(values, attrs[key])) styles.push(`${properties[key]}:${values[attrs[key]]}`);
    }
    if (attrs.radius && typeof attrs.radius === "object") {
      const corners = { topLeft: "top-left", topRight: "top-right", bottomLeft: "bottom-left", bottomRight: "bottom-right" };
      for (const [key, corner] of Object.entries(corners)) {
        if (typeof attrs.radius[key] === "string" && Object.hasOwn(choices.radius, attrs.radius[key])) styles.push(`border-${corner}-radius:${choices.radius[attrs.radius[key]]}`);
      }
    }
    if (Object.hasOwn(choices.align, attrs.textAlign)) styles.push(`text-align:${choices.align[attrs.textAlign]}`);
    if (["row", "box", "grid-item"].includes(node.name)) {
      const align = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };
      const justify = { start: "flex-start", center: "center", end: "flex-end", between: "space-between", around: "space-around" };
      if (Object.hasOwn(align, attrs.align)) styles.push(`align-items:${align[attrs.align]}`);
      if (Object.hasOwn(justify, attrs.justify)) styles.push(`justify-content:${justify[attrs.justify]}`);
    }
    if (/^\d{1,7}(?:\.\d{1,2})?$/.test(attrs.flex) && Number(attrs.flex) <= 1000000) styles.push(`flex:${attrs.flex} 1 0`);
    for (const key of ["width", "height"]) {
      if (/^\d{1,4}(?:px)?$/.test(attrs[key]) && parseFloat(attrs[key]) <= 2000) styles.push(`${key}:${parseFloat(attrs[key])}px`);
      else if (/^\d{1,3}(?:\.\d{1,2})?%$/.test(attrs[key]) && parseFloat(attrs[key]) <= 100) styles.push(`${key}:${attrs[key]}`);
    }
    if (attrs.clip === "true") styles.push("overflow:hidden");
    if (attrs.tabularNums === "true") styles.push("font-variant-numeric:tabular-nums");
    for (const key of ["padding", "gap"]) {
      if (typeof attrs[key] !== "string") continue;
      if (/^\d{1,2}$/.test(attrs[key]) && Number(attrs[key]) <= 12) {
        styles.push(`--archive-layout-${key}:${Number(attrs[key]) * 4}px`);
      } else if (/^\d{1,2}(?:\.\d{1,2})?px$/.test(attrs[key]) && parseFloat(attrs[key]) <= 48) {
        styles.push(`--archive-layout-${key}:${parseFloat(attrs[key])}px`);
      }
    }
    if (attrs.padding && typeof attrs.padding === "object") {
      const { x, y } = attrs.padding;
      if ([x, y].every(value => Number.isInteger(value) && value >= 0 && value <= 12)) {
        styles.push(`--archive-layout-padding:${y * 4}px ${x * 4}px`);
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
    md.inline.ruler.before("html_inline", "archive_escape_inline", (state, silent) => {
      const escaped = readEscape(state.src.slice(0, state.posMax), state.pos);
      if (!escaped) return false;
      if (!silent) state.push("archive_escape", "", 0).content = md.utils.unescapeAll(escaped.content);
      state.pos = escaped.end;
      return true;
    });
    md.renderer.rules.archive_escape = (tokens, index) => md.utils.escapeHtml(tokens[index].content);
    function renderNode(node, env = {}, inline, scope = Object.create(null), budget = { left: MAX_NODES }) {
      if (--budget.left < 0) throw new Error("Layout expansion limit");
      if (node.name === "binding") { scope[node.binding] = node.value; return ""; }
      if (node.name === "each") {
        const items = node.items || valueOf(node.reference, scope)?.value;
        if (!Array.isArray(items) || items.length > 200) throw new Error("Invalid loop data");
        return items.map((item, index) => {
          const local = Object.assign(Object.create(null), scope, { [node.variable]: item });
          if (node.index) local[node.index] = index;
          return children(node, env, inline, local, budget);
        }).join("");
      }
      if (node.name === "if") {
        const result = valueOf(node.expression, scope);
        if (!result) throw new Error("Unsupported conditional content");
        const content = children(node, env, inline, Object.assign(Object.create(null), scope), budget);
        // A static archive includes hidden hints and answers too. The label
        // explains why content hidden in the initial interactive state is visible.
        if (result.value || node.svg || node.containerContext) return content;
        const tag = inline ? "span" : "div";
        return `<${tag} class="archive-static-expanded"><span class="archive-static-note">${escape(globalThis.ChatGPTPdfI18n.t("staticExpandedContent"))}</span>${content}</${tag}>`;
      }
      scope = Object.assign(Object.create(null), scope);
      const attrs = { ...node.attrs };
      for (const key of node.expressions) {
        if (/^on[A-Z]/.test(key)) { delete attrs[key]; continue; }
        if (node.name === "chart" && key === "content") continue;
        if (["width", "height"].includes(key)) {
          // Only a numeric percentage template is accepted, never a function
          // call or arbitrary interpolated CSS from the conversation.
          const template = /^`\$\{([^{}]+)\}%`$/.exec(attrs[key]);
          const percent = template && valueOf(template[1], scope)?.value;
          if (typeof percent === "number" && Number.isFinite(percent) && percent >= 0 && percent <= 100) {
            attrs[key] = `${Math.round(percent * 100) / 100}%`; continue;
          }
        }
        if (["radius", "padding"].includes(key)) {
          const data = literalData(attrs[key], 0);
          if (data && data.end === attrs[key].length && data.value && typeof data.value === "object" && !Array.isArray(data.value)) {
            attrs[key] = data.value; continue;
          }
        }
        const result = valueOf(attrs[key], scope);
        if (!result || result.value === undefined || result.value === null) delete attrs[key];
        else attrs[key] = String(result.value);
      }
      if (node.name === "entity") {
        if (typeof attrs.value !== "string" || !attrs.value.trim()) throw new Error("Missing entity name");
        // Keep the visible name as plain text, inheriting surrounding formatting.
        return md.utils.escapeHtml(md.utils.unescapeAll(attrs.value));
      }
      if (node.name === "asyncimage") {
        // A search query is not an image URL. Keep its description when no
        // embedded pixels are available; never search for a replacement image.
        const label = md.utils.unescapeAll(attrs.alt || attrs.query || globalThis.ChatGPTPdfI18n.t("conversationImage"));
        const cached = env.archiveImageForQuery?.(attrs.query || "");
        const src = attrs.src || attrs.url || cached || "";
        const height = imagePixels(attrs.maxHeight);
        const width = imagePixels(attrs.maxWidth, 40);
        if (/^data:image\/(?:png|jpeg|gif|webp);base64,[a-zA-Z0-9+/=]+$/i.test(src)) {
          const styles = [];
          if (height) styles.push(`max-height:${height}px`, "object-fit:contain");
          if (width) styles.push(`max-width:min(100%,${width}px)`, "flex:none");
          return `<img class="archive-async-image" src="${escape(src)}" alt="${escape(label)}"${styles.length ? ` style="${styles.join(";")}"` : ""}>`;
        }
        const warning = globalThis.ChatGPTPdfI18n.t("imageNotEmbedded", label);
        return `<span class="pdf-asset-warning archive-image-unavailable"${width ? ` style="width:${width}px;flex:none;max-width:100%"` : ""}>${escape(warning)}</span>`;
      }
      if (node.name === "link") {
        const url = md.normalizeLink(md.utils.unescapeAll(attrs.url || attrs.href || ""));
        const label = attrs.title ? md.utils.escapeHtml(md.utils.unescapeAll(attrs.title)) :
          children(node, { ...env, archiveInsideLink: true }, true, scope, budget) || md.utils.escapeHtml(url);
        if (env.archiveInsideLink || !/^https?:\/\//i.test(url) || !md.validateLink(url)) return `<span class="archive-link">${label}</span>`;
        return `<a class="archive-link" href="${md.utils.escapeHtml(url)}" rel="noopener noreferrer">${label}</a>`;
      }
      if (node.name === "chart") {
        const chart = globalThis.ChatGPTArchiveCharts?.render(attrs.content, inline);
        if (!chart) throw new Error("Unsupported chart data");
        return chart;
      }
      if (node.svg) return `<${node.name} ${svgPresentation(node, attrs)}>${children(node, env, inline, scope, budget)}</${node.name}>`;
      if (["list", "list-item"].includes(node.name)) {
        const list = node.name === "list";
        const tag = inline ? "span" : list ? attrs.marker === "number" ? "ol" : "ul" : "li";
        return `<${tag} ${presentation(node, attrs)}${list || inline ? ` role="${list ? "list" : "listitem"}"` : ""}>${children(node, env, inline, scope, budget)}</${tag}>`;
      }
      if (["table", "table-row", "table-cell"].includes(node.name)) {
        const tags = { table: "table", "table-row": "tr", "table-cell": "td" };
        const roles = { table: "table", "table-row": "row", "table-cell": "cell" };
        const tag = inline ? "span" : tags[node.name];
        let content = children(node, env, inline, scope, budget);
        if (node.name === "table" && !inline) content = `<tbody>${content}</tbody>`;
        return `<${tag} ${presentation(node, attrs)}${inline ? ` role="${roles[node.name]}"` : ""}>${content}</${tag}>`;
      }
      const tag = inline ? "span" : "div";
      if (["checkbox", "radio"].includes(node.name)) {
        const selected = node.name === "checkbox" ? attrs.checked === "true" : env.archiveRadioValue === attrs.value;
        const symbol = node.name === "checkbox" ? selected ? "☑" : "☐" : selected ? "●" : "○";
        const label = children(node, env, true, scope, budget);
        return `<${tag} ${presentation(node, attrs)}><span class="archive-control-mark" data-selected="${selected}" aria-hidden="true">${symbol}</span>${label ? `<span class="archive-control-label">${label}</span>` : ""}</${tag}>`;
      }
      if (node.name === "textarea") {
        return `<${tag} ${presentation(node, attrs)}>${escape(md.utils.unescapeAll(attrs.value || attrs.placeholder || ""))}</${tag}>`;
      }
      if (["form", "radio-group"].includes(node.name)) {
        const localEnv = node.name === "radio-group" ? { ...env, archiveRadioValue: attrs.value } : env;
        const note = node.name === "form" ? `<span class="archive-static-note">${escape(globalThis.ChatGPTPdfI18n.t("staticLayoutNotice"))}</span>` : "";
        return `<${tag} ${presentation(node, attrs)}>${note}${children(node, localEnv, inline, scope, budget)}</${tag}>`;
      }
      if (node.name === "button") {
        return `<${tag} ${presentation(node, attrs)}>${children(node, env, true, scope, budget)}<span class="archive-static-note"> (${escape(globalThis.ChatGPTPdfI18n.t("staticControl"))})</span></${tag}>`;
      }
      if (node.name === "icon") {
        const symbols = { "arrow-down": "↓", "arrow-up": "↑", "arrow-right": "→", "arrow-left": "←", check: "✓",
          "check-circle": "✓", clock: "◷", file: "▤", "hard-drive": "▰", hash: "#", "arrow-left-right": "↔",
          puzzle: "◇", lightbulb: "☼", "heart-handshake": "♡", "repeat-2": "↻", users: "♧" };
        return `<${tag} ${presentation(node, attrs)}>${Object.hasOwn(symbols, attrs.name) ? symbols[attrs.name] : ""}</${tag}>`;
      }
      return `<${tag} ${presentation(node, attrs)}>${children(node, env, inline, scope, budget)}</${tag}>`;
    }
    let fragmentId = 0;
    md.inline.ruler.before("html_inline", "archive_fragment_inline", (state, silent) => {
      const marker = /^<archive-fragment key="(\d+)" index="(\d+)"\/>/.exec(state.src.slice(state.pos));
      const fragments = state.env.archiveFragments;
      if (!marker || fragments?.key !== marker[1] || !Object.hasOwn(fragments.html, marker[2])) return false;
      if (!silent) {
        const html = fragments.html[marker[2]];
        state.push("archive_fragment", "", 0).meta = state.linkLevel > 0
          ? html.replace(/<a\b[^>]*>/g, '<span class="archive-link">').replace(/<\/a>/g, "</span>") : html;
      }
      state.pos += marker[0].length;
      return true;
    });
    // Fragment HTML comes only from renderNode, never from conversation HTML.
    md.renderer.rules.archive_fragment = (tokens, index) => tokens[index].meta;
    function children(node, env, inline, scope, budget) {
      const inlineContent = inline || ["text", "caption", "title", "badge", "checkbox", "radio", "button"].includes(node.name);
      const fragments = { key: String(++fragmentId), html: [] };
      let group = "";
      const output = [];
      const localEnv = () => ({ ...env, archiveFragments: fragments, archiveLayoutScope: Object.assign(Object.create(null), scope) });
      function flush() {
        if (!group.trim()) { group = ""; return; }
        output.push(inlineContent ? md.renderInline(dedent(group), localEnv()) : md.render(dedent(group), localEnv()));
        group = "";
      }
      function substitute(source) {
        const replace = fragment => fragment.replace(/\{([^{}\n]+)\}/g, (original, expression) => {
          const result = Object.keys(scope).length && valueOf(expression, scope);
          if (!result || !["string", "number", "boolean"].includes(typeof result.value)) return original;
          return node.svg ? String(result.value) : escape(String(result.value).replace(/[\\`*_[\]{}()!#$~|]/g, "\\$&"));
        });
        // Markdown code spans/blocks retain their original variable examples.
        const protectedCode = /(`+)[\s\S]*?\1(?!`)|(~{3,})[^\n]*\n[\s\S]*?\2(?!~)|^(?: {4}|\t)[^\n]*$/gm;
        let text = "", cursor = 0;
        for (const match of node.svg ? [] : source.matchAll(protectedCode)) {
          text += replace(source.slice(cursor, match.index)) + match[0];
          cursor = match.index + match[0].length;
        }
        return text + replace(source.slice(cursor));
      }
      for (const child of node.children) {
        if (typeof child === "string") {
          if (node.svg) output.push(escape(substitute(md.utils.unescapeAll(child))));
          else group += substitute(child.includes("\n") ? dedent(child) : child);
          continue;
        }
        if (child.name === "binding") { renderNode(child, env, inline, scope, budget); continue; }
        // Images are separate layout children; keeping one in a Markdown
        // paragraph places its following prose beside the image baseline.
        const inlineChild = inlineContent || ["entity", "link"].includes(child.name) ||
          child.name === "icon" && child.attrs.inline === "true";
        if (!node.svg && inlineChild) {
          const index = fragments.html.push(renderNode(child, env, true, scope, budget)) - 1;
          group = group.replace(/(^|\n)[ \t]*$/, "$1");
          group += `<archive-fragment key="${fragments.key}" index="${index}"/>`;
        } else {
          flush();
          output.push(renderNode(child, env, inline, scope, budget));
        }
      }
      flush();
      return output.join("");
    }
    md.block.ruler.before("fence", "archive_binding_block", (state, start, end, silent) => {
      if (state.sCount[start] - state.blkIndent >= 4) return false;
      const offset = state.bMarks[start] + state.tShift[start];
      const node = readBinding(state.src, offset);
      if (!node) return false;
      let last = start;
      while (last < end && state.eMarks[last] < node.end) last++;
      if (last >= end || state.src.slice(node.end, state.eMarks[last]).trim()) return false;
      if (!silent) {
        state.env.archiveLayoutScope ||= Object.create(null);
        state.env.archiveLayoutScope[node.binding] = node.value;
        state.push("archive_binding", "", 0);
        state.line = last + 1;
      }
      return true;
    }, { alt: ["paragraph", "reference", "blockquote", "list"] });
    md.renderer.rules.archive_binding = () => "";
    md.block.ruler.before("fence", "archive_layout_block", (state, start, end, silent) => {
      if (state.sCount[start] - state.blkIndent >= 4) return false;
      const offset = state.bMarks[start] + state.tShift[start];
      if (state.src[offset] !== "<") return false;
      const node = parse(state.src.slice(0, state.eMarks[end - 1]), offset);
      if (!node || ["entity", "asyncimage"].includes(node.name)) return false;
      let last = start;
      while (last < end && state.eMarks[last] < node.end) last++;
      if (last >= end || state.src.slice(node.end, state.eMarks[last]).trim()) return false;
      if (!silent) {
        const token = state.push("archive_layout", "", 0);
        token.block = true;
        token.map = [start, last + 1];
        token.meta = { node, inline: false, scope: { ...state.env.archiveLayoutScope } };
        state.line = last + 1;
      }
      return true;
    }, { alt: ["paragraph", "reference", "blockquote", "list"] });
    md.inline.ruler.before("html_inline", "archive_layout_inline", (state, silent) => {
      if (state.src[state.pos] !== "<") return false;
      const node = parse(state.src.slice(0, state.posMax), state.pos);
      if (!node) return false;
      if (!silent) state.push("archive_layout", "", 0).meta = { node, inline: true, insideLink: state.linkLevel > 0, scope: { ...state.env.archiveLayoutScope } };
      state.pos = node.end;
      return true;
    });
    md.renderer.rules.archive_layout = (tokens, index, options, env) => {
      const { node, inline, insideLink, scope } = tokens[index].meta;
      try { return renderNode(node, insideLink ? { ...env, archiveInsideLink: true } : env, inline, Object.assign(Object.create(null), scope)) + (inline ? "" : "\n"); }
      catch (_) { return inline ? `<code>${escape(node.source)}</code>` : `<pre><code>${escape(node.source)}</code></pre>\n`; }
    };
  }

  globalThis.ChatGPTArchiveLayout = { install, readTag };
})();
