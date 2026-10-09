/* Preview navigation is separate from the document saved as HTML or printed. */
(() => {
  "use strict";
  function init({ main, sidebar, layout }) {
    function clear() {
      layout.hidden = true;
      sidebar.hidden = true;
      sidebar.replaceChildren();
    }
    function refresh() {
      clear();
      if (main.hidden) return;
      const toc = main.querySelector(".pdf-toc");
      if (!toc) return;
      const navigation = toc.cloneNode(true);
      navigation.id = "preview-question-index";
      navigation.className = "preview-toc";
      // The source document owns all export destinations; the preview copy must
      // not duplicate IDs if the document index gains more anchors in future.
      for (const node of navigation.querySelectorAll("[id]")) node.removeAttribute("id");
      sidebar.appendChild(navigation);
      sidebar.hidden = false;
      layout.hidden = false;
    }
    clear();
    return { clear, refresh };
  }
  globalThis.ChatGPTPdfPreviewNavigation = { init };
})();
