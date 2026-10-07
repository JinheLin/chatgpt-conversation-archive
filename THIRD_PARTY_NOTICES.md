# Third-party notices

The extension bundles its runtime assets locally. No CDN is required.

| Component | Version | Files | License |
| --- | --- | --- | --- |
| [markdown-it](https://github.com/markdown-it/markdown-it) | 15.0.2 | `vendor/markdown-it.min.js` | MIT, [full license](vendor/markdown-it.LICENSE) |
| [KaTeX](https://github.com/KaTeX/KaTeX) | 0.19.0 | `vendor/katex.min.js`, `vendor/katex.min.css`, `vendor/fonts/*.woff2` | MIT, [full license](vendor/katex.LICENSE) |

`markdown-it.min.js` is the browser UMD distribution. KaTeX CSS is adjusted to use only the bundled WOFF2 fonts. Original copyright and license notices are preserved in the adjacent license files.
