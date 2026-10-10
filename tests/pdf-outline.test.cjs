const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { installI18n } = require('./helpers/i18n.cjs');
const PDFLib = require('../vendor/pdf-lib.min.js');
const { PDFDocument, PDFName, PDFArray, PDFDict, PDFHexString, PDFString, PDFNumber, PDFRawStream } = PDFLib;
const name = PDFName.of;
const sourceUrl = 'https://chatgpt.com/c/test-conversation';
const metadata = { sourceUrl, questions: [
  { id: 'question-1', title: '第一问：SST 实现有什么不同？' },
  { id: 'question-2', title: 'How does MVCC work?' }
] };
const nestedMetadata = { sourceUrl, questions: metadata.questions.map((entry, index) => ({ ...entry, headings: index === 0 ? [
  { id: 'answer-heading-2-1', title: '共同标题' }, { id: 'answer-heading-2-2', title: 'SST 布局' }
] : [{ id: 'answer-heading-4-1', title: '共同标题' }] })) };

function exporter(locale = 'zh-CN') {
  const context = vm.createContext({ PDFLib, URL });
  installI18n(context, locale);
  for (const file of ['conversation-source.js', 'pdf-outline.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  return context.ChatGPTPdfOutline;
}

async function fixture({ tree = false, missingIndex = false, wrongSource = false, missingQuestion = false, badPage = false, headings = false, missingHeading = false, badHeadingPage = false } = {}) {
  const pdf = await PDFDocument.create();
  pdf.setCreator('Test fixture');
  const first = pdf.addPage([595, 842]);
  const second = pdf.addPage([595, 842]);
  first.drawText('Question index: 1, 2');
  second.drawText('MVCC\n+----+\n| SST |\n+----+');
  first.node.set(name('Annots'), pdf.context.obj([pdf.context.register(pdf.context.obj({
    Type: name('Annot'), Subtype: name('Link'), Rect: [0, 0, 100, 20],
    A: { S: name('URI'), URI: PDFString.of(wrongSource ? 'https://chatgpt.com/c/other' : sourceUrl) }
  }))]));
  const pairs = new Map([
    ['question-1', pdf.context.obj([first.ref, name('XYZ'), 40, 700, null])],
    ['question-2', pdf.context.obj({ D: pdf.context.obj([badPage ? pdf.context.nextRef() : second.ref, name('XYZ'), 40, 321, null]) })]
  ]);
  if (!missingIndex) pairs.set('question-index', pdf.context.obj([first.ref, name('XYZ'), 40, 780, null]));
  if (missingQuestion) pairs.delete('question-2');
  if (headings) {
    pairs.set('answer-heading-2-1', pdf.context.obj([first.ref, name('XYZ'), 40, 500, null]));
    pairs.set('answer-heading-2-2', pdf.context.obj([second.ref, name('XYZ'), 40, 700, null]));
    pairs.set('answer-heading-4-1', pdf.context.obj([badHeadingPage ? pdf.context.nextRef() : second.ref, name('XYZ'), 40, 200, null]));
  }
  if (missingHeading) pairs.delete('answer-heading-2-2');
  if (tree) {
    const leaf = pdf.context.obj({ Names: [...pairs].flatMap(([key, value]) => [PDFHexString.fromText(key), value]) });
    pdf.catalog.set(name('Names'), pdf.context.obj({ Dests: { Kids: [pdf.context.register(leaf)] } }));
  } else {
    const dictionary = pdf.context.obj({});
    for (const [key, value] of pairs) dictionary.set(name(key), value);
    pdf.catalog.set(name('Dests'), dictionary);
  }
  return { pdf, bytes: await pdf.save({ useObjectStreams: false }) };
}

function streams(pdf) {
  return pdf.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFRawStream)
    .map(([ref, object]) => [ref.toString(), Buffer.from(object.getContents()).toString('base64')]);
}

for (const tree of [false, true]) {
  test(`native bookmarks round-trip with precise positions and unchanged content (${tree ? 'name tree' : 'Chrome Dests'})`, async () => {
    const input = await fixture({ tree });
    const before = await PDFDocument.load(input.bytes, { updateMetadata: false });
    const result = await exporter().add(input.bytes, metadata);
    const output = await PDFDocument.load(result.bytes, { updateMetadata: false });
    assert.equal(result.pages, 2);
    assert.equal(result.questions, 2);
    assert.equal(output.getCreator(), before.getCreator());
    assert.deepEqual(streams(output), streams(before));
    assert.equal(output.getPage(0).node.lookup(name('Annots')).toString(), before.getPage(0).node.lookup(name('Annots')).toString());
    assert.equal(output.catalog.get(name('PageMode')).decodeText(), 'UseOutlines');
    const root = output.catalog.lookup(name('Outlines'), PDFDict);
    assert.equal(root.lookup(name('Count'), PDFNumber).asNumber(), 3);
    let ref = root.get(name('First')), previous;
    for (const [index, expected] of ['问题目录', '问题 1 · 第一问：SST 实现有什么不同？', '问题 2 · How does MVCC work?'].entries()) {
      const item = output.context.lookup(ref, PDFDict);
      assert.equal(item.lookup(name('Title'), PDFHexString).decodeText(), expected);
      assert.equal(item.get(name('Parent')).toString(), output.catalog.get(name('Outlines')).toString());
      assert.equal(item.get(name('Prev'))?.toString(), previous?.toString());
      const dest = item.lookup(name('Dest'), PDFArray);
      assert.equal(dest.get(0).toString(), output.getPage(index === 2 ? 1 : 0).ref.toString());
      assert.equal(dest.lookup(3, PDFNumber).asNumber(), [780, 700, 321][index]);
      previous = ref;
      ref = item.get(name('Next'));
    }
    assert.equal(ref, undefined);
    assert.equal(root.get(name('Last')).toString(), previous.toString());
  });
  test(`answer headings form child bookmarks with distinct exact destinations and intact PDF content (${tree ? 'name tree' : 'Chrome Dests'})`, async () => {
    const input = await fixture({ tree, headings: true });
    const before = await PDFDocument.load(input.bytes);
    const result = await exporter().add(input.bytes, nestedMetadata);
    const output = await PDFDocument.load(result.bytes);
    assert.equal(result.questions, 2); assert.equal(result.headings, 3);
    assert.deepEqual(streams(output), streams(before));
    const root = output.catalog.lookup(name('Outlines'), PDFDict);
    assert.equal(root.lookup(name('Count'), PDFNumber).asNumber(), 6);
    const index = root.lookup(name('First'), PDFDict);
    const firstRef = index.get(name('Next')), first = output.context.lookup(firstRef, PDFDict);
    const secondRef = first.get(name('Next')), second = output.context.lookup(secondRef, PDFDict);
    assert.equal(second.get(name('Next')), undefined);
    assert.equal(first.lookup(name('Count'), PDFNumber).asNumber(), 2);
    assert.equal(second.lookup(name('Count'), PDFNumber).asNumber(), 1);
    for (const [parent, parentRef, expected] of [[first, firstRef, [['共同标题', 0, 500], ['SST 布局', 1, 700]]], [second, secondRef, [['共同标题', 1, 200]]]]) {
      let ref = parent.get(name('First')), previous;
      for (const [title, page, y] of expected) {
        const child = output.context.lookup(ref, PDFDict);
        assert.equal(child.lookup(name('Title'), PDFHexString).decodeText(), title);
        assert.equal(child.get(name('Parent')).toString(), parentRef.toString());
        assert.equal(child.get(name('Prev'))?.toString(), previous?.toString());
        const dest = child.lookup(name('Dest'), PDFArray);
        assert.equal(dest.get(0).toString(), output.getPage(page).ref.toString());
        assert.equal(dest.lookup(3, PDFNumber).asNumber(), y);
        previous = ref; ref = child.get(name('Next'));
      }
      assert.equal(ref, undefined);
      assert.equal(parent.get(name('Last')).toString(), previous.toString());
    }
  });
}

test('missing, extra or invalid answer heading targets and duplicate metadata fail without producing misleading bookmarks', async () => {
  for (const options of [{}, { headings: true, missingHeading: true }]) {
    const input = await fixture(options);
    await assert.rejects(exporter().add(input.bytes, nestedMetadata), /回答标题跳转目标/);
  }
  const input = await fixture({ headings: true });
  await assert.rejects(exporter().add(input.bytes, metadata), /回答标题跳转目标/);
  for (const headings of [[{ id: 'question-1', title: 'Wrong kind' }], [nestedMetadata.questions[0].headings[0], nestedMetadata.questions[0].headings[0]], {}, [{ id: 'answer-heading-2-1', title: '' }]]) {
    await assert.rejects(exporter().add(input.bytes, { ...nestedMetadata, questions: [{ ...nestedMetadata.questions[0], headings }, nestedMetadata.questions[1]] }), /回答标题跳转目标/);
  }
  const bad = await fixture({ headings: true, badHeadingPage: true });
  await assert.rejects(exporter().add(bad.bytes, nestedMetadata), /页面跳转目标无效/);
});

test('hidden return links can omit the index destination; bookmark falls back to the first page', async () => {
  const input = await fixture({ missingIndex: true });
  const result = await exporter('en-US').add(input.bytes, metadata);
  const output = await PDFDocument.load(result.bytes);
  const first = output.catalog.lookup(name('Outlines'), PDFDict).lookup(name('First'), PDFDict);
  assert.equal(first.lookup(name('Title'), PDFHexString).decodeText(), 'Question index');
  assert.equal(first.lookup(name('Dest'), PDFArray).get(1).decodeText(), 'Fit');
});

for (const [options, message] of [
  [{ wrongSource: true }, /原始对话链接/],
  [{ missingQuestion: true }, /问题跳转目标与当前对话不一致/],
  [{ badPage: true }, /页面跳转目标无效/]
]) test(`rejects incorrect input: ${Object.keys(options)[0]}`, async () => {
  const input = await fixture(options);
  await assert.rejects(exporter().add(input.bytes, metadata), message);
});

test('rejects invalid PDFs, large inputs, and cyclic destination trees', async () => {
  const api = exporter();
  await assert.rejects(api.add(new Uint8Array([1, 2, 3]), metadata), /无法读取此 PDF/);
  await assert.rejects(api.add({ byteLength: api.MAX_BYTES + 1 }, metadata), /100 MiB/);
  const input = await fixture();
  input.pdf.catalog.delete(name('Dests'));
  const tree = input.pdf.context.obj({});
  const ref = input.pdf.context.register(tree);
  tree.set(name('Kids'), input.pdf.context.obj([ref]));
  input.pdf.catalog.set(name('Names'), input.pdf.context.obj({ Dests: ref }));
  await assert.rejects(api.add(await input.pdf.save(), metadata), /页面跳转目标无效/);
});

test('rejects PDF encryption with a translated message', async () => {
  const input = await fixture();
  // The Encrypt trailer is sufficient to exercise pdf-lib's default refusal.
  input.pdf.context.trailerInfo.Encrypt = input.pdf.context.register(input.pdf.context.obj({ Filter: name('Standard') }));
  await assert.rejects(exporter().add(await input.pdf.save(), metadata), /不支持加密 PDF/);
});
