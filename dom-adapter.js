/* The only file that knows how to locate messages in ChatGPT's page DOM. */
(() => {
  "use strict";

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
      : "ChatGPT conversation";
  }

  globalThis.ChatGPTPdfDomAdapter = { findMessages, getTitle, isConversationPage };
})();
