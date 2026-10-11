/* Chrome selects zh_CN for Simplified Chinese and falls back to default_locale
 * (English) for every other locale, including Traditional Chinese.
 */
(() => {
  "use strict";
  let catalog, loading;
  function t(key, ...values) {
    // An open extension can retain Chrome's older message catalog after local
    // files are updated. The export page loads the matching bundled catalog.
    const entry = catalog?.[key];
    if (entry) return entry.message.replace(/\$(\w+)\$/g, (_, name) => {
      const content = entry.placeholders?.[name.toLowerCase()]?.content;
      if (content === undefined) throw new Error(`Missing placeholder: ${key}.${name}`);
      return content.replace(/\$(\d+)/g, (_, index) => String(values[Number(index) - 1] ?? ""));
    });
    const message = chrome.i18n.getMessage(key, values.map(String));
    if (!message) throw new Error(`Missing translation: ${key}`);
    return message;
  }
  const language = t("documentLanguage");
  function formatTimestamp(value) {
    return new Date(value).toLocaleString(language, {
      year: "numeric", month: "numeric", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    });
  }
  function loadCatalog() {
    if (!loading) loading = (async () => {
      const locale = language === "zh-CN" ? "zh_CN" : "en";
      const response = await fetch(chrome.runtime.getURL(`_locales/${locale}/messages.json`), { cache: "no-store" });
      if (!response.ok) throw new Error(`Could not load extension messages (${response.status}).`);
      const messages = await response.json();
      if (messages.documentLanguage?.message !== language) throw new Error("Invalid extension message catalog.");
      catalog = messages;
    })().catch((error) => { loading = undefined; throw error; });
    return loading;
  }
  function localizeDocument(root) {
    root.documentElement.lang = language;
    for (const node of root.querySelectorAll("[data-i18n]")) {
      node.textContent = t(node.getAttribute("data-i18n"));
    }
  }
  globalThis.ChatGPTPdfI18n = { t, language, formatTimestamp, localizeDocument, loadCatalog };
})();
