/* Chrome selects zh_CN for Simplified Chinese and falls back to default_locale
 * (English) for every other locale, including Traditional Chinese.
 */
(() => {
  "use strict";
  function t(key, ...values) {
    const message = chrome.i18n.getMessage(key, values.map(String));
    if (!message) throw new Error(`Missing translation: ${key}`);
    return message;
  }
  const language = t("documentLanguage");
  function localizeDocument(root) {
    root.documentElement.lang = language;
    for (const node of root.querySelectorAll("[data-i18n]")) {
      node.textContent = t(node.getAttribute("data-i18n"));
    }
  }
  globalThis.ChatGPTPdfI18n = { t, language, localizeDocument };
})();
