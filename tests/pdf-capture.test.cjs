const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { installI18n } = require('./helpers/i18n.cjs');
const ownPage = 'chrome-extension://our-extension/print.html?source=conversation';

function fixture(options = {}) {
  const calls = [], listeners = new Set();
  const parts = options.parts || [
    { data: Buffer.from('%PDF-1.7\n').toString('base64'), base64Encoded: true },
    { data: Buffer.from([0, 255, 128, 10]).toString('base64'), base64Encoded: true, eof: true }
  ];
  const context = vm.createContext({
    URL, Uint8Array, TextEncoder, atob,
    addEventListener: (type, handler) => listeners.add(handler),
    removeEventListener: (type, handler) => listeners.delete(handler),
    chrome: {
      tabs: { getCurrent: async () => options.tab || { id: 42, url: ownPage } },
      runtime: { getURL: file => `chrome-extension://our-extension/${file}` },
      debugger: {
        attach: async (target, version) => {
          calls.push({ method: 'attach', target, version });
          if (options.attachError) throw new Error(options.attachError);
        },
        detach: async target => { calls.push({ method: 'detach', target }); },
        sendCommand: async (target, method, params) => {
          calls.push({ method, target, params });
          if (method === options.fail) throw new Error('Interrupted');
          if (method === 'Page.printToPDF') return options.printResult || { stream: 'pdf-stream' };
          if (method === 'IO.read') return parts.shift();
        }
      }
    }
  });
  installI18n(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'page-layout.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'pdf-capture.js'), 'utf8'), context);
  return { api: context.ChatGPTPdfCapture, calls, listeners, context };
}

test('captures only the current export tab with A4 settings and binary streaming; then closes and detaches', async () => {
  const app = fixture();
  const bytes = await app.api.capture({ landscape: true });
  assert.deepEqual(Buffer.from(bytes), Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from([0, 255, 128, 10])]));
  assert.deepEqual(app.calls.map(call => call.method), ['attach', 'Page.printToPDF', 'IO.read', 'IO.read', 'IO.close', 'detach']);
  for (const call of app.calls) assert.equal(call.target.tabId, 42);
  const params = app.calls[1].params;
  assert.equal(params.landscape, true);
  assert.equal(params.preferCSSPageSize, true);
  assert.equal(params.printBackground, true);
  assert.equal(params.displayHeaderFooter, false);
  assert.equal(params.pageRanges, '');
  assert.equal(params.paperWidth, 210 / 25.4);
  assert.equal(params.paperHeight, 297 / 25.4);
  assert.equal(params.generateTaggedPDF, true);
  assert.equal(params.generateDocumentOutline, false);
  assert.equal(app.listeners.size, 0);
});

test('mobile capture uses the custom sheet, matching CSS margins and full-page streaming', async () => {
  const app = fixture();
  await app.api.capture({ pageLayout: 'mobile' });
  const params = app.calls.find(call => call.method === 'Page.printToPDF').params;
  assert.equal(params.paperWidth, 100 / 25.4);
  assert.equal(params.paperHeight, 180 / 25.4);
  assert.equal(params.marginLeft, 6 / 25.4);
  assert.equal(params.marginRight, 6 / 25.4);
  assert.equal(params.marginTop, 7 / 25.4);
  assert.equal(params.marginBottom, 7 / 25.4);
  assert.equal(params.landscape, false);
  assert.equal(params.preferCSSPageSize, true);
  assert.equal(params.pageRanges, '');
  assert.equal(app.calls.at(-1).method, 'detach');
});

for (const url of ['https://chatgpt.com/c/id', 'chrome-extension://other-extension/print.html', 'chrome-extension://our-extension/worker.js']) {
  test(`refuses to attach to an unrelated tab: ${url}`, async () => {
    const app = fixture({ tab: { id: 42, url } });
    await assert.rejects(app.api.capture(), /only from this extension/);
    assert.equal(app.calls.length, 0);
  });
}

test('attach failure never detaches another debugger session', async () => {
  const app = fixture({ attachError: 'Another debugger is already attached' });
  await assert.rejects(app.api.capture(), /already attached/);
  assert.deepEqual(app.calls.map(call => call.method), ['attach']);
});

for (const fail of ['Page.printToPDF', 'IO.read']) {
  test(`cleans up after interruption at ${fail}`, async () => {
    const app = fixture({ fail });
    await assert.rejects(app.api.capture(), /Interrupted/);
    assert.equal(app.calls.at(-1).method, 'detach');
    assert.equal(app.calls.some(call => call.method === 'IO.close'), fail === 'IO.read');
    assert.equal(app.listeners.size, 0);
  });
}

test('rejects missing/empty PDF streams and unlocks for retries', async () => {
  const app = fixture({ parts: [{ data: '', eof: false }] });
  await assert.rejects(app.api.capture(), /complete PDF/);
  assert.equal(app.calls.at(-2).method, 'IO.close');
  assert.equal(app.calls.at(-1).method, 'detach');
  await assert.rejects(app.api.capture(), /complete PDF/);
  assert.equal(app.calls.filter(call => call.method === 'attach').length, 2);
  const missing = fixture({ printResult: {} });
  await assert.rejects(missing.api.capture(), /complete PDF/);
  assert.equal(missing.calls.at(-1).method, 'detach');
});

test('leaving the page attempts to end its debugger connection', async () => {
  const app = fixture();
  const original = app.context.chrome.debugger.sendCommand;
  app.context.chrome.debugger.sendCommand = async (target, method, params) => {
    if (method === 'Page.printToPDF') {
      await assert.rejects(app.api.capture(), /already in progress/);
      assert.equal(app.listeners.size, 1);
      [...app.listeners][0]();
    }
    return original(target, method, params);
  };
  await app.api.capture();
  assert.equal(app.calls.filter(call => call.method === 'detach').length, 2);
  assert.equal(app.listeners.size, 0);
});
