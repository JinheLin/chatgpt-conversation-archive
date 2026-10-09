# Third-party notices

The extension bundles its runtime assets locally. No CDN is required.

| Component | Version | Files | License |
| --- | --- | --- | --- |
| [markdown-it](https://github.com/markdown-it/markdown-it) | 15.0.2 | `vendor/markdown-it.min.js` | MIT, [full license](vendor/markdown-it.LICENSE) |
| [KaTeX](https://github.com/KaTeX/KaTeX) | 0.19.0 | `vendor/katex.min.js`, `vendor/katex.min.css`, `vendor/fonts/*.woff2` | MIT, [full license](vendor/katex.LICENSE) |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | 1.17.1 | `vendor/pdf-lib.min.js` | MIT, [full license](vendor/pdf-lib.LICENSE) |

`markdown-it.min.js` is the browser UMD distribution. KaTeX CSS is adjusted to use only the bundled WOFF2 fonts. Original copyright and license notices are preserved in the adjacent license files.

Development-only tests use [JSDOM](https://github.com/jsdom/jsdom) 26.1.0 (MIT) and [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB) 6.2.4 (Apache-2.0), pinned in `package-lock.json`. They and their dependencies are installed only for tests, retain their package licenses, and are not loaded by the Chrome extension.
