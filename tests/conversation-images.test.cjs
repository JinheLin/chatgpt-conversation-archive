const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const { fixture, payload } = require('./helpers/reader.cjs');
const project = path.resolve(__dirname, '..');

function page(html = '') {
  const dom = new JSDOM(`<main>${html}</main>`, { url: 'https://chatgpt.com/c/test-conversation', runScripts: 'outside-only' });
  const w = dom.window;
  w.ChatGPTPdfI18n = { t: key => key };
  w.AbortSignal = AbortSignal;
  for (const file of ['layout-markdown.js', 'conversation-images.js', 'dom-adapter.js', 'conversation-source.js']) {
    w.eval(fs.readFileSync(path.join(project, file), 'utf8'));
  }
  return w;
}
const image = (url, extra = '') => `<div data-d-component="image"><img src="${url}" ${extra}></div>`;
const tag = query => `<AsyncImage query="${query}" maxHeight={190}/>`;
const pixels = 'data:image/jpeg;base64,cGljdHVyZQ==';

test('image slots accept static layout attributes and exclude code examples and expressions', () => {
  const w = page();
  const text = `\`${tag('inline example')}\`\n\n\`\`\`html\n${tag('code example')}\n\`\`\`\n` +
    tag('real image') + "\n<ASYNCIMAGE query='other image' maxWidth='116px'/>\n<AsyncImage query={danger()}/>";
  assert.deepEqual(Array.from(w.ChatGPTConversationImages.slots(text), slot => slot.query), ['real image', 'other image']);
  w.close();
});

test('DOM matching uses exact message IDs, excludes favicons, and rejects count and branch ambiguity', async () => {
  const w = page(`<div data-dil-message-id="assistant-1"><img src="https://cdn.invalid/favicon.ico">${image('https://cdn.invalid/one.jpg')}${image('https://cdn.invalid/two.jpg')}</div>
    <div data-dil-message-id="other-branch">${image('https://cdn.invalid/wrong.jpg')}</div>
    <div data-chatgpt-search-message-ids="ambiguous other">${image('https://cdn.invalid/ambiguous.jpg')}</div>`);
  const found = await w.ChatGPTPdfDomAdapter.collectImages([
    { id: 'assistant-1', text: tag('one') + tag('two') }, { id: 'ambiguous', text: tag('ambiguous') },
    { id: 'missing', text: tag('missing') }
  ], { timeout: 0 });
  assert.deepEqual(Array.from(found.get('assistant-1')), ['https://cdn.invalid/one.jpg', 'https://cdn.invalid/two.jpg']);
  assert.equal(found.has('ambiguous'), false);
  assert.equal(found.has('missing'), false);
  assert.equal((await w.ChatGPTPdfDomAdapter.collectImages([{ id: 'assistant-1', text: tag('only one') }], { timeout: 0 })).size, 0);
  w.close();
});

test('lazy images are collected after rendering; only a disposable page may be scrolled', async () => {
  for (const allowScroll of [false, true]) {
    const w = page('<div data-dil-message-id="assistant-1"></div>');
    let scrolled = 0;
    w.HTMLElement.prototype.scrollIntoView = function () { scrolled++; };
    w.setTimeout(() => { w.document.querySelector('[data-dil-message-id]').innerHTML = image('https://cdn.invalid/lazy.jpg'); }, 10);
    const found = await w.ChatGPTPdfDomAdapter.collectImages([{ id: 'assistant-1', text: tag('lazy') }], { allowScroll, timeout: 1000 });
    assert.equal(found.get('assistant-1')[0], 'https://cdn.invalid/lazy.jpg');
    assert.equal(scrolled > 0, allowScroll);
    w.close();
  }
});

test('full reads embed rendered originals without changing answer text or sending tokens to image servers', async () => {
  const text = tag('one') + tag('two');
  const w = page(`<div data-dil-message-id="assistant-1">${image('https://cdn.invalid/one.jpg')}${image('https://cdn.invalid/two.jpg')}</div>`);
  const data = { title: 'Images', current_node: 'assistant-1', mapping: {
    'assistant-1': { id: 'assistant-1', parent: null, children: [], message: {
      id: 'assistant-1', author: { role: 'assistant' }, content: { parts: [text] }
    } }
  } };
  const progress = [], requests = [];
  w.fetch = async (url, options) => {
    requests.push({ url, options: { ...options, headers: { ...options.headers } } });
    if (url === '/api/auth/session') return { ok: true, json: async () => ({ accessToken: 'secret-token' }) };
    if (String(url).startsWith('/backend-api/conversation/')) return { ok: true, json: async () => data };
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.credentials, 'omit');
    return { ok: true, blob: async () => new w.Blob(['original pixels'], { type: 'image/jpeg' }) };
  };
  const result = await w.ChatGPTPdfSource.read(w.location.href, { onProgress: event => progress.push(event) });
  assert.equal(result.messages[0].text, text);
  assert.equal(result.messages[0].layoutImages.length, 2);
  assert.equal(result.messages[0].layoutImages[1].slot, 1);
  assert.match(result.messages[0].layoutImages[0].dataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(progress.at(-1).completed, 2);
  assert.equal(progress.at(-1).total, 2);
  assert.doesNotMatch(JSON.stringify(result) + JSON.stringify(progress), /secret-token/);
  assert.equal(requests.length, 4);
  w.close();
});

test('unchanged answers retain cached originals on failure but changed answers, slots and conversations do not', () => {
  const w = page();
  const before = payload('Question', tag('first') + tag('second'));
  before.messages[1].layoutImages = [{ slot: 0, query: 'first', dataUrl: pixels }, { slot: 1, query: 'second', dataUrl: pixels }];
  const fresh = payload('Question', before.messages[1].text);
  fresh.messages[1].layoutImages = [{ slot: 1, query: 'second', dataUrl: pixels.replace('jpeg', 'png') }];
  w.ChatGPTConversationImages.preserve(fresh, before);
  assert.equal(fresh.messages[1].layoutImages.length, 2);
  assert.match(fresh.messages[1].layoutImages[1].dataUrl, /^data:image\/png/);
  for (const update of [payload('Question', tag('changed')), { ...payload('Question', before.messages[1].text), sourceUrl: 'https://chatgpt.com/c/another' }]) {
    w.ChatGPTConversationImages.preserve(update, before);
    assert.equal(update.messages[1].layoutImages, undefined);
  }
  const legacy = payload('Question', tag('first').replace('/>', ` src="${pixels}"/>`) + tag('second'));
  const updated = payload('Question', tag('first') + tag('second'));
  w.ChatGPTConversationImages.preserve(updated, legacy);
  assert.equal(updated.messages[1].layoutImages[0].dataUrl, pixels);
  w.close();
});

test('embedded layout images survive storage, backups and offline export in their original slots', async () => {
  const app = fixture(), value = payload('Question', tag('repeated') + '\nText between images.\n' + tag('repeated'));
  value.messages[1].layoutImages = [{ slot: 0, query: 'repeated', dataUrl: pixels }, { slot: 1, query: 'repeated', dataUrl: pixels.replace('jpeg', 'png') }];
  await app.w.ChatGPTReaderStore.saveConversation(value);
  const record = await app.w.ChatGPTReaderStore.getConversation(app.w.ChatGPTReaderStore.keyFor(value.sourceUrl));
  assert.equal(record.payload.messages[1].layoutImages.length, 2);
  const backup = await app.w.ChatGPTReaderStore.backup();
  assert.equal(app.w.ChatGPTReaderStore.validateBackup(backup).conversations[0].payload.messages[1].layoutImages.length, 2);
  assert.equal((await app.w.ChatGPTPdfExporter.render(record.payload, app.main)).length, 0);
  assert.deepEqual(Array.from(app.main.querySelectorAll('.archive-async-image'), node => node.src), [pixels, pixels.replace('jpeg', 'png')]);
  const invalid = structuredClone(backup);
  invalid.conversations[0].payload.messages[1].layoutImages[0].dataUrl = 'https://untrusted.invalid/image.jpg';
  assert.throws(() => app.w.ChatGPTReaderStore.validateBackup(invalid));
  app.dom.window.close();
});
