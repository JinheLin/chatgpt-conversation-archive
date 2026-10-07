// Run from the project folder: node tests/source.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const project = path.resolve(__dirname, '..');
const context = vm.createContext({ URL, Date });
vm.runInContext(fs.readFileSync(path.join(project, 'conversation-source.js'), 'utf8'), context);
const { normalize, parseUrl } = context.ChatGPTPdfSource;
const mapping = { root: { id: 'root', parent: null, children: ['m0'], message: null } };
for (let i = 0; i < 300; i++) {
  mapping[`m${i}`] = { id: `m${i}`, parent: i ? `m${i - 1}` : 'root', children: i < 299 ? [`m${i + 1}`] : [],
    message: { id: `m${i}`, author: { role: i % 2 ? 'assistant' : 'user' },
      content: { content_type: 'text', parts: [`message ${i}`] } } };
}
mapping.alternative = { ...mapping.m299, id: 'alternative', parent: 'm298' };
const data = { title: 'long conversation', current_node: 'm299', mapping };
const result = normalize(data, 'https://chatgpt.com/c/test-id');
assert.equal(result.messages.length, 300);
assert.equal(result.completeness.questions, 150);
assert.equal(result.messages[0].text, 'message 0');
assert.equal(result.messages.at(-1).text, 'message 299');
assert.equal(result.messages.some(m => m.id === 'alternative'), false);
assert.throws(() => normalize({ ...data, has_more: true }, ''));
assert.throws(() => normalize({ ...data, current_node: 'missing' }, ''));
assert.throws(() => normalize({ ...data, mapping: { ...mapping, m0: { ...mapping.m0, parent: 'm299' } } }, ''));
assert.throws(() => normalize({ ...data, mapping: { ...mapping, m15: { ...mapping.m15, parent: 'missing' } } }, ''));
assert.throws(() => normalize({ ...data, mapping: { ...mapping, m299: { ...mapping.m299, message: { ...mapping.m299.message, status: 'in_progress' } } } }, ''));
for (const url of ['http://chatgpt.com/c/id', 'https://chatgpt.com.evil.example/c/id', 'https://chatgpt.com/', 'https://u:p@chatgpt.com/c/id', 'https://chatgpt.com:8000/c/id']) assert.throws(() => parseUrl(url));
assert.equal(parseUrl('https://chatgpt.com/g/g-id/c/test-id?x=1#z').url, 'https://chatgpt.com/g/g-id/c/test-id');
assert.equal(parseUrl('https://chatgpt.com/share/test-id').kind, 'share');
const manifest = JSON.parse(fs.readFileSync(path.join(project, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
for (const file of fs.readdirSync(project).filter(f => f.endsWith('.js'))) new vm.Script(fs.readFileSync(path.join(project, file), 'utf8'), { filename: file });
for (const file of [manifest.background.service_worker, ...manifest.content_scripts.flatMap(c => [...c.js, ...c.css])]) assert.ok(fs.existsSync(path.join(project, file)));
console.log('PASS: 300-message full branch, branch selection, incomplete/cyclic/paged/generating rejection, URL validation, JavaScript syntax, manifest resources.');
