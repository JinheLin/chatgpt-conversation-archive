/* The only file that knows how to locate messages in ChatGPT's page DOM. */
(() => {
  "use strict";
  const { t } = globalThis.ChatGPTPdfI18n;

  const ROLE_SELECTOR =
    '[data-message-author-role="user"], [data-message-author-role="assistant"]';
  const TURN_SELECTOR = '[data-turn="user"], [data-turn="assistant"]';
  // Current ChatGPT layout marks search units and their accessible role heading.
  const UNIT_SELECTOR = '[data-chatgpt-search-unit-key], [data-content-search-unit-key]';
  const CONTENT_SELECTORS = [
    "[data-message-content]",
    '[data-testid="message-content"]',
    "[data-message-id]",
    "[data-chatgpt-selection-message-id]"
  ];

  function findMessages() {
    const main = document.querySelector("main");
    const scope = main?.querySelector(`${ROLE_SELECTOR}, ${TURN_SELECTOR}, ${UNIT_SELECTOR}`) ? main : document;
    const authors = [...scope.querySelectorAll(ROLE_SELECTOR)]
      .filter((node) => !node.parentElement?.closest(ROLE_SELECTOR))
      .map((node) => ({ node, role: node.getAttribute("data-message-author-role") }));
    const turns = [...scope.querySelectorAll(TURN_SELECTOR)]
      .filter((node) => !node.matches(ROLE_SELECTOR) && !node.querySelector(ROLE_SELECTOR) &&
        !node.parentElement?.closest(`${ROLE_SELECTOR}, ${TURN_SELECTOR}`))
      .map((node) => ({ node, role: node.getAttribute("data-turn") }));
    const units = [...scope.querySelectorAll(UNIT_SELECTOR)]
      .filter((node) => !node.querySelector(`${ROLE_SELECTOR}, ${TURN_SELECTOR}`) &&
        !node.closest(`${ROLE_SELECTOR}, ${TURN_SELECTOR}`) &&
        !node.parentElement?.closest(UNIT_SELECTOR))
      .map((node) => {
        const key = node.getAttribute("data-chatgpt-search-unit-key") ||
          node.getAttribute("data-content-search-unit-key") || "";
        const role = key.match(/:(user|assistant)$/)?.[1] ||
          node.querySelector("[data-conversation-role]")?.getAttribute("data-conversation-role");
        return { node, role };
      }).filter(({ role }) => role === "user" || role === "assistant");

    return [...authors, ...turns, ...units]
      .sort((a, b) => a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
      .map(({ node, role }) => {
        const content = CONTENT_SELECTORS
          .map((selector) => node.querySelector(selector))
          .find(Boolean) || node;
        return { role, content };
      });
  }

  function isConversationPage() {
    return /(?:^|\/)c\/[^/]+/.test(location.pathname) ||
      Boolean(document.querySelector(`${ROLE_SELECTOR}, ${TURN_SELECTOR}, ${UNIT_SELECTOR}`));
  }

  function getTitle() {
    const title = document.title
      .replace(/\s*[-–—|]\s*ChatGPT\s*$/i, "")
      .trim();
    return title && title.toLowerCase() !== "chatgpt"
      ? title
      : t("conversationTitle");
  }

  function messageRoots(id) {
    const scope = document.querySelector("main") || document;
    const exact = [...scope.querySelectorAll("[data-dil-message-id], [data-message-id], [data-chatgpt-selection-message-id]")]
      .filter(node => ["data-dil-message-id", "data-message-id", "data-chatgpt-selection-message-id"]
        .some(attr => node.getAttribute(attr) === id));
    if (exact.length) return exact;
    // A unit containing several different messages is ambiguous. Do not assign
    // its images by global page order or accidentally use another branch.
    return [...scope.querySelectorAll("[data-chatgpt-search-message-ids]")].filter(node => {
      const ids = new Set((node.getAttribute("data-chatgpt-search-message-ids") || "").split(/\s+/).filter(Boolean));
      return ids.size === 1 && ids.has(id);
    });
  }

  function imageUrls(root) {
    // Semantic image components exclude avatars, citation favicons and icons.
    return [...root.querySelectorAll('[data-d-component="image"] img')].map(img => {
      try {
        const url = new URL(img.currentSrc || img.getAttribute("src") || "", location.href);
        return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password &&
          (img.currentSrc || img.getAttribute("src")) ? url.href : null;
      } catch (_) { return null; }
    });
  }

  async function collectImages(messages, { allowScroll = false, timeout = 12000 } = {}) {
    const tasks = messages.map(message => ({ id: message.id, slots: globalThis.ChatGPTConversationImages.slots(message.text) }))
      .filter(task => task.slots.length);
    const found = new Map();
    if (!tasks.length) return found;
    const deadline = Date.now() + timeout;
    let scrollIndex = 0;
    function scan() {
      for (const task of tasks) {
        if (found.has(task.id)) continue;
        const candidates = messageRoots(task.id).map(imageUrls)
          .filter(urls => urls.length === task.slots.length && urls.every(Boolean));
        if (candidates.length && candidates.every(urls => urls.join("\n") === candidates[0].join("\n"))) {
          found.set(task.id, candidates[0]);
        }
      }
    }
    scan();
    while (found.size < tasks.length && Date.now() < deadline) {
      if (allowScroll) {
        const missing = tasks.filter(task => !found.has(task.id));
        const task = missing[scrollIndex++ % missing.length];
        const roots = messageRoots(task.id);
        if (roots.length) roots[0].scrollIntoView({ block: "start", behavior: "instant" });
        else {
          // Virtualized conversations reveal their semantic units when the
          // temporary background page is scrolled. Never scroll a user's tab.
          const units = [...document.querySelectorAll(UNIT_SELECTOR)];
          units[scrollIndex % Math.max(1, units.length)]?.scrollIntoView({ block: "start", behavior: "instant" });
        }
      }
      await new Promise(resolve => setTimeout(resolve, 200));
      scan();
    }
    return found;
  }

  globalThis.ChatGPTPdfDomAdapter = { findMessages, getTitle, isConversationPage, collectImages };
})();
