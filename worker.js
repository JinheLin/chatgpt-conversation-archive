"use strict";
importScripts("conversation-source.js");

function openExporter(source = "") {
  const query = new URLSearchParams();
  try {
    query.set("source", globalThis.ChatGPTPdfSource.parseUrl(source).url);
  } catch (_) { /* A homepage or unrelated tab opens the empty input page. */ }
  return chrome.tabs.create({ url: chrome.runtime.getURL(`print.html?${query}`) });
}
chrome.action.onClicked.addListener((tab) => {
  openExporter(tab.url || "").catch((error) => console.error("Could not open exporter:", error.message));
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "OPEN_EXPORT_PAGE" || sender.id !== chrome.runtime.id) return false;
  openExporter(typeof message.source === "string" ? message.source : sender.url || "").then(() => sendResponse({ ok: true }),
    () => sendResponse({ ok: false, error: "无法打开导出页面。" }));
  return true;
});
