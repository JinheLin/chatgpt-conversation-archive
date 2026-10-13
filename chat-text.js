/* Rich editors may use paragraphs or soft breaks for the same question. */
(() => {
  "use strict";
  function normalize(value) {
    return String(value).replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ")
      .replace(/\n(?:[ \t]*\n)+/g, "\n").trim();
  }
  function same(left, right) { return normalize(left) === normalize(right); }
  function read(input) {
    if (input.matches("textarea")) return input.value;
    if (typeof input.innerText === "string") return input.innerText;
    // Also works in DOM fixtures. textContent alone discards <br> and paragraph breaks.
    function visit(node) {
      if (node.nodeType === 3) return node.data;
      if (node.nodeType !== 1) return "";
      if (node.tagName === "BR") return "\n";
      const value = [...node.childNodes].map(visit).join("");
      return value + (/^(?:P|DIV|LI)$/.test(node.tagName) ? "\n" : "");
    }
    return [...input.childNodes].map(visit).join("");
  }
  globalThis.ChatGPTReaderChatText = { normalize, same, read };
})();
