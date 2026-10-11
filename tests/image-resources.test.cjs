const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const sourceUrl = 'https://chatgpt.com/c/images';
const imageUrl = 'https://images.openai.com/static-rsc-4/original?purpose=inline';

function fixture(options = {}) {
  const calls = [], events = new Set(), progress = [];
  const binary = Buffer.from([0, 255, 128, 13, 10]);
  const payload = { sourceUrl, messages: [{ text: '<AsyncImage query="original"/>', imageSources: [
    { slot: 0, query: 'original', url: imageUrl }, { slot: 1, query: 'duplicate', url: imageUrl }
  ] }] };
  const context = vm.createContext({ URL, Blob, Uint8Array, TextEncoder, atob, clearTimeout,
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; },
    FileReader: class {
      async readAsDataURL(blob) { this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`; this.onload(); }
    },
    addEventListener: (type, fn) => events.add(fn), removeEventListener: (type, fn) => events.delete(fn),
    ChatGPTPdfSource: { parseUrl: value => ({ url: new URL(value).href }) },
    chrome: {
      tabs: { get: async () => ({ id: 90, url: options.tabUrl || sourceUrl }) },
      debugger: {
        attach: async target => { calls.push({ method: 'attach', target }); if (options.attachError) throw new Error('Debugger occupied'); },
        detach: async target => calls.push({ method: 'detach', target }),
        sendCommand: async (target, method, params) => {
          calls.push({ method, target, params });
          if (method === options.fail) throw new Error('Interrupted');
          if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'background-frame' } } };
          if (method === 'Network.loadNetworkResource') return { resource: {
            success: true, httpStatusCode: 200, headers: { 'Content-Type': options.mime || 'image/jpeg' }, stream: 'original-image'
          } };
          if (method === 'IO.read') return { data: binary.toString('base64'), base64Encoded: true, eof: true };
        }
      }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'image-resources.js'), 'utf8'), context);
  return { api: context.ChatGPTImageResources, calls, events, payload, binary, progress,
    capture: extra => context.ChatGPTImageResources.capture(90, sourceUrl, payload, { ...extra, onProgress: item => progress.push(item) }) };
}

test('image resource capture uses only the specified conversation background tab, omits credentials and preserves original binary bytes', async () => {
  const app = fixture();
  await app.capture();
  assert.deepEqual(app.calls.map(call => call.method), ['attach', 'Page.getFrameTree', 'Network.loadNetworkResource', 'IO.read', 'IO.close', 'detach']);
  assert.equal(app.payload.messages[0].layoutImages.length, 2);
  assert.deepEqual(Buffer.from(app.payload.messages[0].layoutImages[0].dataUrl.split(',')[1], 'base64'), app.binary);
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls[2].params)), {
    frameId: 'background-frame', url: imageUrl, options: { disableCache: false, includeCredentials: false }
  });
  assert.ok(app.calls.every(call => call.target.tabId === 90));
  assert.equal(app.progress.at(-1).completed, 2);
  assert.equal(app.events.size, 0);
});

test('resource URLs are restricted to observed OpenAI raster image routes and conversation mismatch cannot attach', async () => {
  const app = fixture({ tabUrl: 'https://chatgpt.com/c/another' });
  await app.capture();
  assert.equal(app.calls.length, 0);
  for (const url of ['http://images.openai.com/static-rsc/a', 'https://images.openai.com.evil.invalid/static-rsc/a',
    'https://user:password@images.openai.com/static-rsc/a', 'https://chatgpt.com/api/auth/session',
    'https://images.openai.com/settings', 'file:///private']) assert.equal(app.api.allowed(url), false);
  assert.equal(app.api.allowed(imageUrl), true);
});

for (const options of [{ mime: 'text/html' }, { fail: 'IO.read' }]) {
  test('failed or non-image resources close their stream, detach and leave the original unavailable marker: ' + JSON.stringify(options), async () => {
    const app = fixture(options);
    await app.capture();
    assert.equal(app.payload.messages[0].layoutImages, undefined);
    assert.equal(app.calls.at(-1).method, 'detach');
    assert.ok(app.calls.some(call => call.method === 'IO.close'));
    assert.equal(app.events.size, 0);
  });
}

test('cancellation and another debugger connection are respected', async () => {
  const cancelled = fixture();
  await cancelled.capture({ isCancelled: () => true });
  assert.equal(cancelled.calls.length, 0);
  const busy = fixture({ attachError: true });
  await assert.rejects(busy.capture(), /occupied/);
  assert.deepEqual(busy.calls.map(call => call.method), ['attach']);
});
