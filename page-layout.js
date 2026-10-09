/* One page definition for preview, code fitting and Chrome's PDF capture. */
(() => {
  "use strict";
  const profiles = Object.freeze({
    portrait: Object.freeze({ id: "portrait", width: 210, height: 297, landscape: false,
      top: 16, right: 17, bottom: 18, left: 17 }),
    landscape: Object.freeze({ id: "landscape", width: 210, height: 297, landscape: true,
      top: 16, right: 17, bottom: 18, left: 17 }),
    mobile: Object.freeze({ id: "mobile", width: 100, height: 180, landscape: false,
      top: 7, right: 6, bottom: 7, left: 6 })
  });
  function resolve(value = "portrait") {
    // Keep the earlier boolean API for adapters that still pass orientation.
    const id = typeof value === "boolean" ? (value ? "landscape" : "portrait") : value;
    if (!Object.hasOwn(profiles, id)) throw new Error("Unknown page layout: " + id);
    return profiles[id];
  }
  function contentSize(value) {
    const page = resolve(value);
    return { width: (page.landscape ? page.height : page.width) - page.left - page.right,
      height: (page.landscape ? page.width : page.height) - page.top - page.bottom };
  }
  function css(value) {
    const page = resolve(value);
    const size = page.id === "mobile" ? `${page.width}mm ${page.height}mm` : `A4 ${page.id}`;
    return `@page { size: ${size}; margin: ${page.top}mm ${page.right}mm ${page.bottom}mm ${page.left}mm; }`;
  }
  globalThis.ChatGPTPageLayout = { resolve, contentSize, css };
})();
