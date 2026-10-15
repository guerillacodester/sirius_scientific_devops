const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relativePath, imports = {}) {
  const file = path.resolve(__dirname, '..', relativePath);
  const source = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require(name) {
      if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
      return imports[name];
    },
    Number, Response,
  }, { filename: file });
  return module.exports;
}

const helpers = load('app/task-update.ts');
const task = { id: 123, summary: 'Preserve tablet connection', project: { name: 'Tablet' } };
const repositories = [
  { project: 'Tablet', repoName: 'tablet', url: 'https://example.test/tablet', localPath: 'E:\\tablet' },
  { project: 'POS', repoName: 'pos', url: 'https://example.test/pos' },
];
const input = { repoName: 'tablet', updateText: 'Keep the connection alive on rotation.' };

test('draft uses task reference and the specific update, without inventing test evidence', () => {
  assert.equal(helpers.draftCommitMessage(123, 'Preserve\ntablet connection', ' Update A '),
    'Preserve tablet connection (Mantis #123)\n\nUpdate A');
  assert.notEqual(helpers.draftCommitMessage(123, task.summary, 'Update A'),
    helpers.draftCommitMessage(123, task.summary, 'Update B'));
});

test('note contains selected repository, local path, progress, and draft', () => {
  const result = helpers.prepareTaskUpdate(task, repositories, input);
  assert.equal(result.repository.repoName, 'tablet');
  assert.ok(result.text.includes('Repository URL: https://example.test/tablet'));
  assert.ok(result.text.includes('Local path: E:\\tablet'));
  assert.ok(result.text.includes(input.updateText));
  assert.ok(result.text.endsWith(result.commitMessage));
});

test('edited commit message is preserved', () => {
  const result = helpers.prepareTaskUpdate(task, repositories, { ...input, commitMessage: 'Manual title\n\nManual body' });
  assert.equal(result.commitMessage, 'Manual title\n\nManual body');
});

test('multiple repositories require the selected mapping from the actual task project', () => {
  const extra = { project: 'Tablet', repoName: 'second', url: 'https://example.test/second' };
  assert.equal(helpers.prepareTaskUpdate(task, [...repositories, extra], { ...input, repoName: 'second' }).repository.url, extra.url);
  assert.throws(() => helpers.prepareTaskUpdate(task, repositories, { ...input, repoName: 'pos' }), /not registered/);
  assert.throws(() => helpers.prepareTaskUpdate(task, [], input), /not registered/);
});

test('invalid inputs fail before writing a note', () => {
  for (const bad of [
    { ...input, repoName: '' }, { ...input, repoName: 1 },
    { ...input, updateText: ' ' }, { ...input, updateText: {} },
    { ...input, commitMessage: '' }, { ...input, commitMessage: 1 },
  ]) assert.throws(() => helpers.prepareTaskUpdate(task, repositories, bad));
});

function routeHarness({ failRead = false, failWrite = false, found = true } = {}) {
  const calls = [];
  const route = load('app/api/issues/[id]/updates/route.ts', {
    'next/server': { NextResponse: Response },
    '../../../mantis': {
      publicError: String,
      async mantisFetch(url, options) {
        calls.push({ url, options });
        if (!options) {
          if (failRead) throw new Error('Task read failed');
          return { issues: found ? [task] : [] };
        }
        if (failWrite) throw new Error('Note write failed');
        return { note: { id: 10 } };
      },
    },
    '../../../repos/store': { readRegistry: async () => ({ repositories }) },
    '../../../../task-update': helpers,
  });
  return { calls, post: (value = input, id = '123') => route.POST({ json: async () => value }, { params: Promise.resolve({ id }) }) };
}

test('endpoint writes exactly one private note and returns the saved draft', async () => {
  const h = routeHarness();
  const response = await h.post();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).commitMessage, helpers.draftCommitMessage(task.id, task.summary, input.updateText));
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].url, '/api/rest/issues/123');
  assert.equal(h.calls[1].url, '/api/rest/issues/123/notes');
  assert.equal(h.calls[1].options.method, 'POST');
  assert.equal(JSON.parse(h.calls[1].options.body).view_state.name, 'private');
});

test('endpoint rejects invalid IDs and bodies without contacting Mantis', async () => {
  for (const id of ['0', '-1', '1/notes', '9007199254740992']) {
    const h = routeHarness();
    assert.equal((await h.post(input, id)).status, 400);
    assert.equal(h.calls.length, 0);
  }
  for (const body of [null, [], 'text']) {
    const h = routeHarness();
    assert.equal((await h.post(body)).status, 400);
    assert.equal(h.calls.length, 0);
  }
});

test('endpoint rejects cross-project mapping and empty updates without writes', async () => {
  for (const bad of [{ ...input, repoName: 'pos' }, { ...input, updateText: '' }]) {
    const h = routeHarness();
    assert.equal((await h.post(bad)).status, 400);
    assert.equal(h.calls.length, 1);
  }
});

test('missing task returns 404', async () => {
  const h = routeHarness({ found: false });
  assert.equal((await h.post()).status, 404);
  assert.equal(h.calls.length, 1);
});

test('Mantis read and write failures do not report a saved draft', async () => {
  for (const options of [{ failRead: true }, { failWrite: true }]) {
    const response = await routeHarness(options).post();
    assert.equal(response.status, 500);
    assert.equal((await response.json()).commitMessage, undefined);
  }
});
