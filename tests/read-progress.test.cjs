const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { installI18n } = require('./helpers/i18n.cjs');
const project = path.resolve(__dirname, '..');
const sourceUrl = 'https://chatgpt.com/c/progress-test';

function readerFixture(data, status = 200, streaming) {
  const progress = [], fetches = [];
  let streamResponse;
  let ticks = 0;
  const context = vm.createContext({
    URL, Date, AbortSignal, TextDecoder, performance: { now: () => ticks += 101 }, location: new URL(sourceUrl),
    FileReader: class {
      readAsDataURL() { this.result = 'data:image/png;base64,cGljdHVyZQ=='; this.onload(); }
    },
    fetch: async (url, options) => {
      fetches.push(url);
      if (url === '/api/auth/session') return { ok: true, json: async () => ({ accessToken: 'private-token' }) };
      if (url === '/backend-api/conversation/progress-test') {
        assert.equal(options.headers.Authorization, 'Bearer private-token');
        if (streaming) {
          const bytes = new TextEncoder().encode(streaming.invalidJson ? '{invalid' : JSON.stringify(data));
          const headers = streaming.encoding ? { 'content-encoding': streaming.encoding } : { 'content-length': String(bytes.length) };
          streamResponse = new Response(new ReadableStream({ start(controller) {
            for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
            controller.close();
          } }), { status, headers });
          return streamResponse;
        }
        return { ok: status === 200, status, json: async () => data };
      }
      if (url === '/backend-api/files/one/download') return {
        ok: true, json: async () => ({ download_url: 'https://assets.example/image.png' })
      };
      if (url === 'https://assets.example/image.png') {
        assert.equal(options.headers.Authorization, undefined);
        return { ok: true, blob: async () => ({ size: 16 }) };
      }
      return { ok: false, status: 403 };
    }
  });
  installI18n(context);
  vm.runInContext(fs.readFileSync(path.join(project, 'conversation-source.js'), 'utf8'), context);
  return { progress, fetches, stream: () => streamResponse?.body, read: () => context.ChatGPTPdfSource.read(sourceUrl, {
    onProgress: event => progress.push(JSON.parse(JSON.stringify(event)))
  }) };
}

const data = {
  title: 'Progress test', current_node: 'message', mapping: {
    message: { id: 'message', parent: null, children: [], message: {
      id: 'message', author: { role: 'user' }, content: { parts: [
        'Question ![one](https://assets.example/unavailable.png) ![two](https://assets.example/unavailable.png)',
        { image_asset_pointer: 'file-service://one' },
        { image_asset_pointer: 'file-service://one' },
        { content_type: 'unsupported_component' }
      ] }, metadata: { attachments: [{ id: 'one' }, { id: 'missing' }, { id: 'missing' }] }
    } }
  }
};

test('asset progress counts processed tasks including unsupported and failed assets without leaking content or credentials', async () => {
  const reader = readerFixture(data);
  const payload = await reader.read();
  assert.deepEqual(reader.progress.slice(0, 3), [{ stage: 'session' }, { stage: 'conversation' }, { stage: 'verify' }]);
  assert.deepEqual(reader.progress.slice(3), Array.from({ length: 6 }, (_, completed) => ({ stage: 'assets', completed, total: 5 })));
  assert.equal(reader.fetches.filter(url => url === '/backend-api/files/one/download').length, 1);
  assert.equal(reader.fetches.filter(url => url === '/backend-api/files/missing/download').length, 1);
  assert.equal(reader.fetches.filter(url => url === 'https://assets.example/unavailable.png').length, 1);
  assert.equal(payload.messages[0].assets.length, 4);
  assert.equal(payload.messages[0].assets.filter(asset => asset.error).length, 2);
  assert.doesNotMatch(JSON.stringify(reader.progress), /private-token|Question|https?:|data:/);
});

for (const encoding of [null, 'gzip']) {
  test(`streamed JSON preserves split Chinese characters, reports received bytes and releases its reader (${encoding || 'identity'})`, async () => {
    const plain = structuredClone(data);
    plain.mapping.message.message.content.parts = ['中文问题，保留全部内容'];
    delete plain.mapping.message.message.metadata;
    const reader = readerFixture(plain, 200, { encoding });
    const payload = await reader.read();
    assert.equal(payload.messages[0].text, '中文问题，保留全部内容');
    const downloads = reader.progress.filter(event => event.received !== undefined);
    assert.ok(downloads.length > 1);
    assert.ok(downloads[0].received < downloads.at(-1).received);
    for (const event of downloads) {
      if (encoding) assert.equal(event.total, undefined);
      else assert.ok(event.total >= event.completed);
    }
    assert.equal(reader.stream().locked, false);
    assert.doesNotMatch(JSON.stringify(downloads), /中文|private-token|https?:/);
  });
}

test('invalid streamed JSON fails and releases the stream reader', async () => {
  const reader = readerFixture(data, 200, { invalidJson: true });
  await assert.rejects(reader.read(), /JSON|position|property/i);
  assert.equal(reader.stream().locked, false);
});

test('a text-only conversation skips attachment progress and remains fully readable', async () => {
  const plain = structuredClone(data);
  plain.mapping.message.message.content.parts = ['Question'];
  delete plain.mapping.message.message.metadata;
  const reader = readerFixture(plain);
  const payload = await reader.read();
  assert.deepEqual(reader.progress.map(event => event.stage), ['session', 'conversation', 'verify']);
  assert.equal(payload.messages.length, 1);
  assert.equal(payload.completeness.verified, true);
});

test('a failed conversation request does not claim verification or attachment progress', async () => {
  const reader = readerFixture(data, 403);
  await assert.rejects(reader.read(), /HTTP 403/);
  assert.deepEqual(reader.progress.map(event => event.stage), ['session', 'conversation']);
});
