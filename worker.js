"use strict";

function openExporter(source = "") {
  const query = new URLSearchParams();
  if (/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(source)) query.set("source", source);
  return chrome.tabs.create({ url: chrome.runtime.getURL(`print.html?${query}`) });
}
chrome.action.onClicked.addListener((tab) => {
  openExporter(tab.url || "").catch((error) => console.error("Could not open exporter:", error.message));
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "OPEN_EXPORT_PAGE" || sender.id !== chrome.runtime.id) return false;
  openExporter(sender.url || "").then(() => sendResponse({ ok: true }),
    () => sendResponse({ ok: false, error: "无法打开导出页面。" }));
  return true;
});
