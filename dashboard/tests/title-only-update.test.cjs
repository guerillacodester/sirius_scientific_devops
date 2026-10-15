const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, imports) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: (name) => imports[name] });
  return exports;
}
const hierarchy = load('app/hierarchy.ts', {});
const payload = load('app/api/issues/payload.ts', {});
function harness() {
  const calls = [], bridges = [];
  const item = { id: 92, summary: 'Planning epic', description: '', project: { id: 1, name: 'Project' }, custom_fields: [{ field: { name: 'Work Item Type' }, value: 'Epic' }] };
  const updates = load('app/api/issues/update.ts', {
    '../mantis': { mantisFetch: async (url, options) => { calls.push({ url, options }); return { issues: [item] }; } },
    '../project-bridge': { projectBridge: async (input) => bridges.push(input) }, '../../hierarchy': hierarchy,
  });
  return { ...updates, item, calls, bridges };
}
test('full editor save keeps an empty epic description and sends assignment through the restricted bridge', async () => {
  const api = harness();
  const body = payload.issuePayload({ summary: 'Planning epic', description: '', project: 'Project', type: 'Epic', assigneeId: '7' }, true);
  await api.saveIssueUpdate(92, body, api.item);
  assert.equal(api.bridges.length, 1);
  assert.equal(api.bridges[0].payload.handler.id, 7);
  assert.equal(api.bridges[0].payload.project, undefined);
  assert.equal(api.bridges[0].payload.description, undefined);
  assert.equal(api.item.description, '');
  assert.ok(api.calls.every((call) => !call.options));
});
test('assignment-only patch loads the current record before choosing the blank-description path', async () => {
  const api = harness();
  await api.saveIssueUpdate(92, { handler: { id: 7 } });
  assert.equal(api.calls.length, 2);
  assert.equal(api.bridges.length, 1);
});
test('normal records and newly supplied descriptions retain native REST validation', async () => {
  for (const [existing, type, body] of [['Existing', 'Epic', { handler: { id: 7 } }], ['', 'Bug', { handler: { id: 7 } }], ['', 'Epic', { description: 'Actual supplied description' }]]) {
    const api = harness(); api.item.description = existing; api.item.custom_fields[0].value = type;
    await api.saveIssueUpdate(92, body, api.item);
    assert.equal(api.bridges.length, 0);
    assert.equal(api.calls[0].options.method, 'PATCH');
  }
});
test('blank planning records cannot silently move projects and new records still require descriptions', async () => {
  const api = harness();
  await assert.rejects(api.saveIssueUpdate(92, { project: { name: 'Other project' } }, api.item), /Add a description/);
  assert.equal(api.bridges.length, 0);
  assert.throws(() => payload.issuePayload({ summary: 'New', project: 'Project', category: 'General', description: '' }), /required/);
});
