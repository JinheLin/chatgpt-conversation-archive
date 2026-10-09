# ChatGPT Conversation Archive

English | [简体中文](README_zh.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A Chrome extension that exports a ChatGPT conversation from its URL to PDF or a single offline HTML file, with a clickable index of every user question.

No server, API key, or dependency installation is required to use the extension. It reads the selected conversation branch using your existing ChatGPT login session, so export does not depend on scrolling through lazy-loaded messages.

The interface follows Chrome's UI language: Simplified Chinese uses Chinese; all other languages, including Traditional Chinese, use English. This applies to export controls, progress and error messages, and navigation labels in exported documents. Conversation text is preserved in its original language.

## Quick start

### 1. Get the project

```bash
git clone https://github.com/JinheLin/chatgpt-conversation-archive.git
```

Alternatively, choose **Code → Download ZIP** on GitHub and extract the archive.

### 2. Load the extension

1. Keep the entire `chatgpt-conversation-archive` folder, including `vendor`.
2. Open `chrome://extensions/` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the project root containing `manifest.json`.
4. Sign in to ChatGPT in the same Chrome profile.
5. Open Chrome's **Extensions** menu and click **ChatGPT Conversation Archive**, or pin it and click its toolbar icon. Open it while viewing a ChatGPT conversation to automatically read that conversation.

### 3. Export a conversation

1. When opened with a conversation URL, the export page fills in the URL and starts reading automatically.
2. When opened without a URL, or from the ChatGPT homepage or another website, enter a conversation URL such as `https://chatgpt.com/c/…` and click **Read full conversation**.
3. Follow the percentage bar through connection, reading, validation, attachments and formatting. Progress moves smoothly between reported values. When the server supplies a reliable response size, reading advances with downloaded bytes; otherwise it shows received data and an activity indicator. Attachments advance from 60% to 80%, message rendering from 80% to 95%, and fonts/code fitting up to 99%. Rendering and code fitting run in small batches so the page can refresh and accept cancellation. This is overall workflow progress, not remaining time; 100% appears only after validation and formatting finish.
4. Hover over or click **Export** and choose **HTML** or **PDF**. Keyboard users can focus **Export**, press Enter or Arrow Down to open the menu, use arrow keys to choose an option, and press Escape to close it.
   - **Export → HTML**: download a single file containing styles, math fonts, and successfully retrieved images and attachments. The question index and return links work locally.
   - **Export → PDF**: creates and downloads an A4 PDF with native sidebar bookmarks for the index and every question in one step. It keeps the rendered text, tables, math and diagrams. There is no print dialog or file re-selection. Open the file and select **Bookmarks** in Chrome's PDF sidebar.
   - For wide text diagrams, select **A4 landscape** before exporting PDF or saving HTML.
   - **Show links back to the question index** is checked by default. Uncheck it to hide return links in the preview, offline HTML and PDF. The question index at the beginning remains available.
   - **More options** includes manual **Print / Save PDF** and **Add PDF sidebar index** for existing files. For manual printing, select **Save as PDF**, A4, **All** pages and default scale. Disable **Headers and footers** and enable **Background graphics** if needed. Manual print output needs the separate bookmark step.

Reading reuses an already-open tab for the requested conversation without changing or closing it. If none is available, a temporary ChatGPT tab opens in the background; it remains visible in the tab bar but does not interrupt the export page. On success or cancellation, the temporary tab closes. On failure, it remains available for checking login or access problems. Completion does not switch your active tab. You can cancel and retry.

After updating local files, click **Reload** on the extension card in `chrome://extensions/`, accept any new permission prompt, then refresh any open ChatGPT and export pages. Version 2.2 adds the `debugger` permission for direct PDF generation. Refreshing ChatGPT also removes page buttons and status banners left by older versions.

### PDF index versus sidebar bookmarks

The index printed at the beginning is a page of clickable links. The sidebar directory is a native PDF outline. **Export → PDF** includes both automatically: Chrome renders the current extension export tab to PDF, then the extension adds question bookmarks using the exact destinations in that PDF. All processing happens locally. No extra tab is created for PDF rendering.

Chrome may display a debugging notice while rendering. The extension attaches only to its own export tab and disconnects as soon as the PDF data has been read, including on errors. It does not attach to ChatGPT or unrelated tabs. If direct export fails, close DevTools on the export tab and retry; browser policy or another debugger can prevent the connection. Manual printing is available under **More options**.

When adding bookmarks to an existing PDF under **More options**, keep the same conversation loaded. The extension checks the original conversation link, every question destination and the referenced pages. Save **all pages** with Chrome's built-in **Save as PDF**, rather than a system PDF printer that may remove destinations. Older exports also work if their conversation link and question destinations are intact. If you edited or regenerated that conversation after exporting, save a fresh PDF first. Encrypted files and PDFs over 100 MiB are not supported.

## How it handles lazy loading

Version 2 reads ChatGPT's conversation data using your ChatGPT login session in the current browser. It follows `current_node → parent → root` to reconstruct the selected branch, then renders messages in chronological order.

- No scrolling or waiting for older messages to appear is required. Messages that the page removes from the DOM when they leave the viewport are still included in the returned branch.
- Missing parent nodes, cycles, explicit pagination flags, an ambiguous branch, or messages still being generated cause an error instead of an export claiming completeness.
- The export page checks that message and question counts match the rendered document.
- **Complete** means the visible user and assistant messages in the branch returned by the server, including assistant progress updates. System instructions, internal analysis, tool calls, and unselected branches from edits or regenerated answers are excluded.
- Validation cannot prove that ChatGPT's server has never lost historical data. Deleted messages and inaccessible content cannot be recovered.

## Formatting and attachments

- Renders the original Markdown, preserving headings, bold text, lists, blockquotes, tables, links, code blocks, and math.
- Converts ChatGPT's boxes, grids, rows, titles, captions, badges, arrows, and basic SVG diagrams into static layouts in the preview, PDF, and offline HTML. Supports bounded literal-array loops, numeric arithmetic, and conditional presentation without executing JavaScript. Only supported layout and SVG attributes are accepted; tags in code examples remain literal source.
- Uses monospace text for code and text diagrams, preserving spaces, tabs, and line breaks without forced wrapping. Wide blocks are scaled to the available A4 width. Short blocks are kept together where possible; blocks longer than a page may still split.
- Detects some unfenced box-drawing diagrams and preserves them as monospace blocks.
- Supports Chinese and English text through system fonts. Chinese characters in monospace blocks depend on font fallback; alignment errors already present in a source diagram are not redrawn automatically.
- Includes A4 print styles for keeping headings with following content, controlling orphans and widows, and keeping tables together when they fit on one page. Tables taller than a full page can still split, with repeated headers and breaks within rows avoided where possible.
- Renders math locally with KaTeX. Offline HTML embeds the required math fonts and needs no CDN.
- Converts ChatGPT citation components into **Sources** links and lists sources at the end of the corresponding message. ChatGPT controls and feedback toolbars are omitted.
- Embeds downloadable attachments in HTML. Non-image files have download links in the document. PDF shows attachment descriptions; it does not embed those files as PDF attachments.
- Images, audio, video, or special components that cannot be retrieved or converted are explicitly marked in the document and reported in the export status. A complete message chain does not guarantee successful conversion of every attachment.

## Project structure and maintenance

| File | Responsibility |
| --- | --- |
| `manifest.json` | Manifest V3 configuration, host permissions, entry points, and script order |
| `i18n.js` / `_locales/` | Chrome message lookup, page localization, and English/Simplified Chinese catalogs; English is the default locale |
| `worker.js` | Opens the export page from the Chrome toolbar |
| `content.js` | Read request bridge; adds no page controls or banners and cleans up old instances on reinjection |
| `dom-adapter.js` | Independent DOM adapter and semantic selectors; retains extraction and cleanup helpers for diagnostics, while full export does not depend on the DOM |
| `conversation-source.js` | URL validation, website data endpoints, branch reconstruction, completeness checks, and attachment embedding |
| `export.js` | Markdown and math rendering, question index, diagram preservation, and code width fitting |
| `layout-markdown.js` | Restricted ChatGPT layout parsing and static rendering without enabling raw HTML |
| `pdf-outline.js` | Local PDF validation and native sidebar bookmarks using the existing question destinations |
| `pdf-capture.js` | Transient debugger connection to the current export tab, Chrome PDF rendering and bounded binary streaming |
| `export-menu.js` | Hover, click and keyboard interactions for the HTML/PDF export menu |
| `read-progress.js` | Smooth, cancellable interpolation of reported progress with reduced-motion support |
| `print.html` / `print.js` | URL input, progress, cancellation, HTML download, one-step PDF export and manual printing |
| `style.css` | Export interface and A4 print styles |
| `vendor/` | Bundled Markdown, math and PDF libraries, fonts, and original licenses |

The DOM adapter prefers semantic attributes such as `data-message-author-role`, `data-chatgpt-search-unit-key`, `data-content-search-unit-key`, `data-chatgpt-selection-message-id`, and `data-markdown-text-style` over generated CSS classes. Update this adapter when the page structure changes, and update `conversation-source.js` when website data endpoints change. Do not silently substitute a partial DOM snapshot for a complete export.

## Permissions and data handling

The extension requests `scripting`, `debugger` and host access to `chatgpt.com` and `chat.openai.com`. `debugger` is required for one-step Chrome PDF rendering and cannot be an optional permission ([Chrome permissions documentation](https://developer.chrome.com/docs/extensions/reference/api/permissions)). This is a powerful browser permission; the implementation limits it to this extension's own `print.html` tab, only while exporting a PDF, and always attempts to disconnect afterward. It does not connect to ChatGPT or other browsing tabs.

The current ChatGPT login session is used within a ChatGPT content script. Temporary credentials stay in the reading function's memory; they are not written to disk, extension storage, HTML, PDF, or logs, and are not sent to other websites. Third-party image requests do not carry those credentials.

Rendering happens locally, with no upload service. Raw HTML in Markdown is not executed, and math rendering uses `trust: false`. Offline HTML disables scripts and embeds fonts and images as data URLs. Clicking a source link still opens its website.

## Development and debugging

- **Cannot open the exporter:** confirm the extension is enabled, then use Chrome's **Extensions** menu or the pinned toolbar icon.
- **Link is present in the export page address but the input stays empty:** reload the extension and refresh the export page. The exporter now fills the entry link before localization and loads fresh bundled messages, so Chrome's older locale cache cannot interrupt automatic reading. Startup failures appear in the status area.
- **Reading fails:** confirm you are signed in to ChatGPT in the same Chrome profile where the extension is installed and can open the URL manually. HTTP 401, 403, or 404 can also indicate access restrictions, an expired session, or changed website endpoints.
- **Extension loading errors:** open **Errors** on the extension card. Click **Service Worker** to inspect entry-point errors.
- **Rendering or download errors:** right-click the export page and choose **Inspect**. Use the temporary ChatGPT tab's developer tools to inspect request status. Do not share credential-bearing headers or unredacted network logs.
- **The page keeps loading older messages:** this does not prevent full-chain export. If the conversation data request also times out, the extension reports an error.
- **No build step is required:** use `node --check` to check individual JavaScript files, not HTML files.

For development, install Node.js 18 or later and run from the project root:

```bash
npm test
```

Tests use Node.js's built-in test runner and the bundled PDF library, so `npm install` is unnecessary. They cover long message chains, alternative branches, missing parents, cycles, pagination, messages still being generated, invalid URLs, toolbar entry links, reading without page controls or banners, tab reuse and cancellation, background reading without focus changes, JavaScript syntax, and Manifest resource paths. PDF tests check precise bookmark positions, Unicode titles, unchanged content and rejection of incorrect files. Changes to the interface or print styles also need visual checks in Chrome.

## Known limitations

1. Uses **undocumented ChatGPT website endpoints**, not a guaranteed stable public API. Website updates may require adapter changes. No OpenAI API key is needed.
2. Private conversations must be accessible to the current signed-in account. Shared conversation data can also change; export is refused if completeness cannot be validated. The real conversation validation described below used a private `/c/` URL.
3. Only the selected branch is exported. Alternative answers and edited branches are not merged, and internal analysis or tool logs are not included.
4. Formatting is reconstructed from Markdown rather than copied pixel for pixel. Code syntax highlighting is not implemented, and Mermaid is preserved as source. Canvas content, interactive charts, and video players are not guaranteed to render as static content.
5. Embedded attachments are limited to 20 MiB per file and 35 MiB of total downloaded attachment data. Oversized attachments remain marked in the document. Access restrictions, cross-origin rules, or expired attachments can prevent embedding. Very large conversations are also limited by Chrome's memory and message size constraints.
6. Extremely wide code lines use smaller fonts; A4 landscape is often more suitable. Browser pagination still has limits for long code blocks, tall table rows, and math.
7. Direct PDF export requires Chrome's debugger permission and can be blocked by enterprise policy, another debugger or DevTools attached to the export tab. Browser download settings control the save location. Manual printing remains available and requires a separate bookmark step. Whether the bookmark pane opens automatically can differ between PDF readers.

## Bundled dependencies

These are included in the repository; no installation is needed:

- markdown-it 15.0.2, MIT: [project](https://github.com/markdown-it/markdown-it), [security notes](https://github.com/markdown-it/markdown-it/blob/master/docs/safety.md).
- KaTeX 0.19.0, MIT: [project](https://github.com/KaTeX/KaTeX), [browser documentation](https://katex.org/docs/browser.html).
- pdf-lib 1.17.1, MIT: [project](https://github.com/Hopding/pdf-lib), [documentation](https://pdf-lib.js.org/). Used only for local PDF bookmark insertion.

## Validation scope

Validated in a Chrome profile signed in to ChatGPT with a long technical conversation: 40 messages, 13 questions, and a 228-page A4 PDF, including text diagrams, tables, two file attachments, and internal PDF index links. The private conversation and exported files are not published with this project.

Native bookmark insertion was separately validated on a 122-page Chrome PDF with 17 questions. An independent PDF reader confirmed all bookmark pages and vertical positions; all page content streams remained unchanged, and the first two rendered pages matched the original exactly. Direct PDF tests mock Chrome's debugger API to check target restrictions, A4 options, stream handling, cleanup, bookmark/download sequencing and UI restoration on failure. The direct export flow has not yet been verified through an actual Chrome debugger session.

## Contributing and reporting issues

Issues and pull requests are welcome. Include your Chrome version, extension version, reproduction steps, and redacted error details. Account credentials and full private conversations are not needed.

## License

This project is licensed under the [MIT License](LICENSE). Bundled libraries and fonts retain their original licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
