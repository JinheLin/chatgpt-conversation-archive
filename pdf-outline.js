/* Add native PDF outline entries to Chrome's printed PDF without re-rendering.
 * Destination names and source links come from the exporter's existing HTML.
 * All processing stays in memory; no files or conversation data are uploaded.
 */
(() => {
  "use strict";
  const { t } = globalThis.ChatGPTPdfI18n;
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFString, PDFHexString, PDFNumber } = globalThis.PDFLib;
  const name = (value) => PDFName.of(value);
  const MAX_BYTES = 100 * 1024 * 1024;

  function destinations(pdf) {
    const result = new Map();
    const direct = pdf.catalog.lookupMaybe(name("Dests"), PDFDict);
    if (direct) for (const [key, value] of direct.entries()) result.set(key.decodeText(), value);
    const names = pdf.catalog.lookupMaybe(name("Names"), PDFDict);
    const tree = names?.lookupMaybe(name("Dests"), PDFDict);
    const seen = new Set();
    function visit(node, depth = 0) {
      if (seen.has(node) || depth > 64) throw new Error(t("pdfDestinationsInvalid"));
      seen.add(node);
      const pairs = node.lookupMaybe(name("Names"), PDFArray);
      if (pairs) {
        if (pairs.size() % 2) throw new Error(t("pdfDestinationsInvalid"));
        for (let i = 0; i < pairs.size(); i += 2) {
          const key = pdf.context.lookup(pairs.get(i));
          if (!(key instanceof PDFString || key instanceof PDFHexString)) throw new Error(t("pdfDestinationsInvalid"));
          result.set(key.decodeText(), pairs.get(i + 1));
        }
      }
      const kids = node.lookupMaybe(name("Kids"), PDFArray);
      if (kids) for (let i = 0; i < kids.size(); i++) visit(kids.lookup(i, PDFDict), depth + 1);
    }
    if (tree) visit(tree);
    return result;
  }

  function destinationArray(pdf, value, pages) {
    let dest = pdf.context.lookup(value);
    if (dest instanceof PDFDict) dest = dest.lookup(name("D"));
    if (!(dest instanceof PDFArray) || dest.size() < 2 ||
        !(dest.get(0) instanceof PDFRef) || !pages.has(dest.get(0).toString())) {
      throw new Error(t("pdfDestinationsInvalid"));
    }
    return dest;
  }

  function sameConversation(left, right) {
    try {
      const a = globalThis.ChatGPTPdfSource.parseUrl(left);
      const b = globalThis.ChatGPTPdfSource.parseUrl(right);
      return a.kind === b.kind && a.id === b.id;
    } catch (_) { return false; }
  }

  function verifySource(pdf, sourceUrl) {
    const annotations = pdf.getPage(0).node.lookupMaybe(name("Annots"), PDFArray);
    if (annotations) for (let i = 0; i < annotations.size(); i++) {
      const action = annotations.lookup(i, PDFDict).lookupMaybe(name("A"), PDFDict);
      const uri = action?.lookup(name("URI"));
      if ((uri instanceof PDFString || uri instanceof PDFHexString) && sameConversation(uri.decodeText(), sourceUrl)) return;
    }
    throw new Error(t("pdfSourceMismatch"));
  }

  async function add(bytes, metadata) {
    if (bytes.byteLength > MAX_BYTES) throw new Error(t("pdfTooLarge"));
    let pdf;
    try { pdf = await PDFDocument.load(bytes, { updateMetadata: false }); }
    // pdf-lib's ES5 error subclasses do not retain their names/prototypes.
    catch (error) { throw new Error(t(error.message === new globalThis.PDFLib.EncryptedPDFError().message ? "pdfEncrypted" : "pdfInvalid")); }
    if (!pdf.getPageCount()) throw new Error(t("pdfInvalid"));
    verifySource(pdf, metadata.sourceUrl);
    const entries = metadata.questions;
    if (!entries?.length || entries.some((entry, index) => entry.id !== `question-${index + 1}` || !entry.title)) {
      throw new Error(t("pdfQuestionMismatch"));
    }
    const named = destinations(pdf);
    const questionNames = [...named.keys()].filter((key) => /^question-\d+$/.test(key));
    if (questionNames.length !== entries.length || entries.some((entry) => !named.has(entry.id))) {
      throw new Error(t("pdfQuestionMismatch"));
    }
    const pageRefs = new Set(pdf.getPages().map((page) => page.ref.toString()));
    const targets = entries.map((entry, index) => ({
      title: `${t("questionLabel", index + 1)} · ${entry.title}`,
      dest: destinationArray(pdf, named.get(entry.id), pageRefs)
    }));
    // Chrome may omit an unreferenced index anchor when return links are hidden.
    const indexDest = named.has("question-index")
      ? destinationArray(pdf, named.get("question-index"), pageRefs)
      : pdf.context.obj([pdf.getPage(0).ref, name("Fit")]);
    targets.unshift({ title: t("questionIndex"), dest: indexDest });

    const root = pdf.context.obj({ Type: name("Outlines") });
    const rootRef = pdf.context.register(root);
    const items = targets.map((target) => pdf.context.obj({
      Title: PDFHexString.fromText(target.title), Parent: rootRef, Dest: target.dest
    }));
    const refs = items.map((item) => pdf.context.register(item));
    items.forEach((item, index) => {
      if (index) item.set(name("Prev"), refs[index - 1]);
      if (index + 1 < refs.length) item.set(name("Next"), refs[index + 1]);
    });
    root.set(name("First"), refs[0]);
    root.set(name("Last"), refs.at(-1));
    root.set(name("Count"), PDFNumber.of(items.length));
    pdf.catalog.set(name("Outlines"), rootRef);
    pdf.catalog.set(name("PageMode"), name("UseOutlines"));
    const output = await pdf.save({ useObjectStreams: false });
    return { bytes: output, questions: entries.length, pages: pdf.getPageCount() };
  }

  globalThis.ChatGPTPdfOutline = { add, MAX_BYTES };
})();
