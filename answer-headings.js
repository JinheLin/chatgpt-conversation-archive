/* Select answer sections from content and heading structure without rewriting text. */
(() => {
  "use strict";
  const chineseDigits = { "零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
  const chineseUnits = { "十": 10, "百": 100, "千": 1000 };
  const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];

  function ordinal(source) {
    if (/^\d{1,3}$/.test(source)) return Number(source);
    if (/^[IVX]+$/.test(source)) return roman.indexOf(source) + 1;
    if (!/^[零〇一二两三四五六七八九十百千]+$/.test(source)) return 0;
    let total = 0, digit = 0;
    for (const char of source) {
      if (Object.hasOwn(chineseDigits, char)) digit = chineseDigits[char];
      else { total += (digit || 1) * chineseUnits[char]; digit = 0; }
    }
    return total + digit;
  }

  function numbering(title) {
    const text = title.normalize("NFKC");
    let match = /^第([零〇一二两三四五六七八九十百千\d]+)(章|节|部分|篇)\s*[:、.\s]?\s*\S/.exec(text);
    if (match) return { family: `chapter-${match[2]}`, order: ordinal(match[1]) };
    match = /^(Chapter|Part|Section)\s+(\d{1,3}|[IVX]+)\b[\s:.\-]*\S/i.exec(text);
    if (match) return { family: match[1].toLowerCase(), order: ordinal(match[2].toUpperCase()) };
    match = /^\(?([零〇一二两三四五六七八九十百千\d]+)\)\s*\S/.exec(text);
    if (match) return { family: /^\d/.test(match[1]) ? "arabic-parentheses" : "chinese-parentheses", order: ordinal(match[1]) };
    match = /^([一二两三四五六七八九十百千]+)[、,.:]\s*\S/.exec(text);
    if (match) return { family: "chinese", order: ordinal(match[1]) };
    match = /^(\d{1,3})(?:[、,:]|\.(?!\d))\s*\S/.exec(text);
    if (match) return { family: "arabic", order: ordinal(match[1]) };
    match = /^([IVX]+)\.\s+\S/.exec(text);
    return match && { family: "roman", order: ordinal(match[1]) };
  }

  function label(node) {
    const copy = node.cloneNode(true);
    for (const citation of copy.querySelectorAll(".pdf-citation")) citation.remove();
    for (const math of copy.querySelectorAll(".katex")) {
      const source = math.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
      math.replaceWith(node.ownerDocument.createTextNode(source || math.textContent));
    }
    return copy.textContent.replace(/\s+/g, " ").trim();
  }

  function select(body) {
    const candidates = [];
    let precedingLevel = 0;
    // Only body-root blocks can be sections: lists, quotes, diagrams and code
    // retain their own internal structure and never become navigation entries.
    for (const node of body.children) {
      const heading = /^H[1-6]$/.test(node.tagName);
      if (heading) precedingLevel = Number(node.tagName.slice(1));
      if (!heading && (node.tagName !== "P" || !numbering(node.textContent.trim().slice(0, 160))?.order)) continue;
      if (!heading && [...node.querySelectorAll("code")].some(code => code.textContent.trim() === node.textContent.trim())) continue;
      const title = label(node);
      if (!title) continue;
      const number = numbering(title);
      if (!heading && (!number?.order || title.length > 120 || node.querySelector("br, img") || /\n\s*\S/.test(node.textContent))) continue;
      candidates.push({ node, title, number, heading, level: heading ? precedingLevel : precedingLevel + 1 });
    }
    const headings = candidates.filter(candidate => candidate.heading);
    let sections = headings;
    // A lone leading, unnumbered heading above the rest is an answer title.
    // Skip it to reach actual sections, including answers with a title/subtitle.
    while (sections.length > 1) {
      const level = Math.min(...sections.map(candidate => candidate.level));
      const peers = sections.filter(candidate => candidate.level === level);
      if (peers.length !== 1 || peers[0] !== sections[0] || peers[0].number?.order) break;
      sections = sections.slice(1);
    }
    const sectionLevel = sections.length ? Math.min(...sections.map(candidate => candidate.level)) : Infinity;
    const groups = new Map();
    for (const candidate of candidates) {
      if (!candidate.number?.order) continue;
      const family = candidate.number.family;
      if (!groups.has(family)) groups.set(family, []);
      groups.get(family).push(candidate);
    }
    // Consistent increasing numbering is stronger evidence than Markdown level.
    // A group below the structural section level is a set of subsections.
    const numbered = [...groups.values()].filter(group => group.length >= 2 &&
      group.every((candidate, index) => index === 0 || candidate.number.order > group[index - 1].number.order) &&
      Math.min(...group.map(candidate => candidate.level)) <= sectionLevel)
      .sort((a, b) => Math.min(...a.map(candidate => candidate.level)) - Math.min(...b.map(candidate => candidate.level)) ||
        candidates.indexOf(a[0]) - candidates.indexOf(b[0]));
    if (numbered.length) {
      const group = numbered[0], selected = new Set(group);
      const level = Math.min(...group.map(candidate => candidate.level));
      const first = candidates.indexOf(group[0]);
      // Keep unnumbered peer sections such as a final summary after the chapters.
      return candidates.filter((candidate, index) => selected.has(candidate) ||
        index > first && candidate.heading && candidate.level === level && !candidate.number?.order);
    }
    return sections.filter(candidate => candidate.level === sectionLevel);
  }
  globalThis.ChatGPTAnswerHeadings = { select };
})();
