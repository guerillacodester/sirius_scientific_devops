const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.transpileModule(readFileSync(path.join(__dirname, '../app/navigation.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const moduleExports = {};
vm.runInNewContext(source, { exports: moduleExports });
const { tabFromHash, workTabForType, workspaceTabs } = moduleExports;

test('every workspace tab has a working deep link', () => {
  for (const tab of workspaceTabs) assert.equal(tabFromHash(`#${tab.id}`), tab.id);
  assert.equal(new Set(workspaceTabs.map((tab) => tab.id)).size, 8);
});
test('legacy work and board links open Tasks; unknown links open Overview', () => {
  assert.equal(tabFromHash('#work'), 'tasks');
  assert.equal(tabFromHash('#board'), 'tasks');
  for (const hash of ['', '#dashboard', '#missing']) assert.equal(tabFromHash(hash), 'overview');
  assert.equal(tabFromHash('#hierarchy?project=1&item=2'), 'hierarchy');
});
test('tasks, features, and bugs are separated without dropping existing work types', () => {
  for (const type of ['Task', 'Technical Debt']) assert.equal(workTabForType(type), 'tasks');
  for (const type of ['Feature', 'Epic', 'User Story', 'Improvement']) assert.equal(workTabForType(type), 'features');
  assert.equal(workTabForType('Bug'), 'bugs');
  assert.equal(workTabForType(''), 'hierarchy');
  assert.equal(workTabForType('Custom type'), 'hierarchy');
});
