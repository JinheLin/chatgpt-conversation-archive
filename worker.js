"use strict";
importScripts("i18n.js", "conversation-source.js");

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
