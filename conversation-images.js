/* Image identities and cached pixels; never change the original answer text. */
(() => {
  "use strict";
  const valid = value => typeof value === "string" &&
    /^data:image\/(?:png|jpeg|gif|webp);base64,[a-zA-Z0-9+/=]+$/i.test(value);

  function slots(text) {
    const result = [];
    if (typeof text !== "string") return result;
    // Mask code examples without moving the offsets used below.
    const masked = text.replace(/(^|\n)( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\2\3[^\n]*(?=\n|$)|$)/g,
      match => " ".repeat(match.length)).replace(/(`+)[^`]*?\1/g, match => " ".repeat(match.length));
    for (const match of masked.matchAll(/<AsyncImage\b/gi)) {
      const tag = globalThis.ChatGPTArchiveLayout?.readTag(text, match.index);
      if (!tag?.selfClosing || tag.expressions.includes("query") || !tag.attrs.query) continue;
      result.push({ query: tag.attrs.query, start: match.index, end: tag.end, src: tag.attrs.src || "" });
    }
    return result;
  }

  function originalText(text) {
    const entries = slots(text);
    for (const slot of entries.reverse()) {
      if (!valid(slot.src)) continue;
      const tag = text.slice(slot.start, slot.end).replace(/\s+src\s*=\s*(?:"[^"]*"|'[^']*')/i, "");
      text = text.slice(0, slot.start) + tag + text.slice(slot.end);
    }
    return text;
  }

  function preserve(payload, previous) {
    if (!previous || previous.sourceUrl !== payload.sourceUrl) return payload;
    const old = new Map(previous.messages.map(message => [message.id, message]));
    for (const message of payload.messages) {
      const before = old.get(message.id);
      if (!before || before.role !== message.role || originalText(before.text) !== originalText(message.text)) continue;
      const entries = slots(message.text), oldSlots = slots(before.text);
      message.layoutImages = entries.map((slot, index) => {
        const fresh = message.layoutImages?.find(image => image.slot === index && image.query === slot.query);
        const cached = before.layoutImages?.find(image => image.slot === index && image.query === slot.query);
        const src = valid(fresh?.dataUrl) ? fresh.dataUrl : valid(cached?.dataUrl) ? cached.dataUrl : oldSlots[index]?.src;
        return valid(src) ? { slot: index, query: slot.query, dataUrl: src } : null;
      }).filter(Boolean);
    }
    return payload;
  }
  globalThis.ChatGPTConversationImages = { slots, valid, preserve };
})();
