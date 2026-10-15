const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, URLSearchParams, Number, require: (name) => {
    if (!(name in imports)) throw new Error(`Unexpected import ${name}`);
    return imports[name];
  } });
  return exports;
}
const h = load('app/hierarchy.ts');
function item(id, type, parent = '', project = 1) {
  return { id, summary: `Item ${id}`, project: { id: project, name: `Project ${project}` }, custom_fields: [
    { field: { name: 'Work Item Type' }, value: type }, { field: { name: 'Parent Issue' }, value: String(parent) },
  ] };
}
const items = [item(1, 'Epic'), item(2, 'User Story', 1), item(3, 'Feature', 2), item(4, 'Task', 3), item(5, 'Bug', 4)];

test('builds Epic > Story > Feature > Task > Bug tree with each item once', () => {
  const roots = h.buildHierarchy(items);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].children[0].children[0].children[0].children[0].item.id, 5);
  const ids = [];
  function visit(nodes) { for (const node of nodes) { ids.push(node.item.id); visit(node.children); } }
  visit(roots);
  assert.deepEqual(ids, [1, 2, 3, 4, 5]);
});
test('rejects invalid parents, self links, and cross-project parents', () => {
  assert.throws(() => h.validateParent(items[0], 1, items), /own parent/);
  assert.throws(() => h.validateParent(items[1], 3, items), /cycle/);
  assert.throws(() => h.validateParent(items[4], 3, items), /requires Task/);
  assert.throws(() => h.validateParent(items[2], 1, items), /requires User Story/);
  assert.throws(() => h.validateParent(item(6, 'Task', '', 2), 3, items), /same project/);
  assert.throws(() => h.validateParent(items[4], 999, items), /unavailable/);
});
test('detects ancestor cycles and retains malformed records as visible roots', () => {
  const cyclic = [item(1, 'Epic', 2), item(2, 'User Story', 1)];
  assert.throws(() => h.validateParent(item(9, 'Task'), 2, cyclic), /cycle/);
  assert.equal(h.buildHierarchy(cyclic).length, 2);
  assert.ok(h.buildHierarchy(cyclic).every((node) => node.warning));
  assert.equal(h.buildHierarchy([item(9, 'Task', 888)])[0].item.id, 9);
});
test('filtered tree retains matching descendants and their ancestors', () => {
  const roots = h.filterHierarchy(h.buildHierarchy(items), new Set([5]));
  assert.equal(roots[0].item.id, 1);
  assert.equal(roots[0].children[0].children[0].children.length, 1);
  assert.equal(roots[0].children[0].children[0].children[0].children[0].item.id, 5);
});
test('only epics can be roots; board ordering preserves other items', () => {
  h.validateParent(items[0], null, items);
  for (const entry of items.slice(1)) assert.throws(() => h.validateParent(entry, null, items), /requires a/);
  assert.deepEqual(Array.from(h.reorderItems([1, 2, 3], 3, 1)), [3, 1, 2]);
  assert.deepEqual(Array.from(h.reorderItems([1, 2, 3], 1)), [2, 3, 1]);
  assert.deepEqual(Array.from(h.reorderItems([1, 2, 3], 2, 2)), [1, 2, 3]);
});
test('payload explicitly clears parent on update but omits empty parent on create', () => {
  const { issuePayload } = load('app/api/issues/payload.ts');
  assert.equal(issuePayload({ parentId: '' }, true).custom_fields[0].value, '');
  assert.equal(issuePayload({ summary: 'S', description: 'D', project: 'P', category: 'C', parentId: '' }).custom_fields, undefined);
  assert.equal(issuePayload({ summary: 'Planning title', description: '' }, true).description, undefined);
});

function serverHarness(extra = {}) {
  const calls = [];
  const records = extra.items ?? items;
  const api = load('app/api/issues/hierarchy.ts', {
    '../../hierarchy': h,
    '../mantis': { mantisFetch: async (url) => {
      calls.push(url);
      if (url === '/api/rest/projects') return { projects: [{ id: 1, name: 'Project 1' }, { id: 2, name: 'Project 2' }] };
      if (url.includes('?')) return { issues: extra.pages ? extra.pages[Number(new URLSearchParams(url.split('?')[1]).get('page')) - 1] ?? [] : records };
      return { issues: records.filter((record) => record.id === Number(url.split('/').at(-1))) };
    } },
  });
  return { ...api, calls };
}
test('server requires complete ancestry and rejects unlink, cycles, and changed child types', async () => {
  const api = serverHarness();
  await api.validateHierarchyInput({ parentId: '3' }, 4);
  await assert.rejects(api.validateHierarchyInput({ parentId: '' }, 4), /requires a Feature/);
  await api.validateHierarchyInput({ parentId: '' }, 1);
  await assert.rejects(api.validateHierarchyInput({ parentId: '3' }, 1), /cycle/);
  await assert.rejects(api.validateHierarchyInput({ type: 'Task' }, 2), /requires Feature/);
  await assert.rejects(api.validateHierarchyInput({ project: 'Project 2' }, 3), /same project/);
  for (const parentId of ['-1', '0', 'abc', null, [], '9007199254740992']) {
    await assert.rejects(api.validateHierarchyInput({ parentId }, 4), /positive integer/);
  }
});
test('server validates parent for new work items without writing anything', async () => {
  const api = serverHarness();
  await api.validateHierarchyInput({ project: 'Project 1', type: 'Task', parentId: '3' });
  await assert.rejects(api.validateHierarchyInput({ project: 'Project 2', type: 'Task', parentId: '3' }), /same project/);
  assert.ok(api.calls.every((call) => call.startsWith('/api/rest/')));
});
test('pagination fetches beyond the first 100 and fails if Mantis repeats a page', async () => {
  const first = Array.from({ length: 100 }, (_, index) => item(index + 100, 'Task'));
  const api = serverHarness({ pages: [first, [item(999, 'Epic')]] });
  assert.equal((await api.allProjectIssues('1')).length, 101);
  assert.ok(api.calls[1].includes('page=2'));
  assert.ok(api.calls[1].includes('project_id=1'));
  await assert.rejects(serverHarness({ pages: [first, first] }).allProjectIssues(), /did not advance/);
});

function patchHarness(current, invalid = false) {
  const writes = [];
  const route = load('app/api/issues/[id]/route.ts', {
    'next/server': { NextResponse: Response },
    '../../mantis': { publicError: String, mantisFetch: async (url, options) => { writes.push({ url, options }); return { issues: [current] }; } },
    '../payload': load('app/api/issues/payload.ts'),
    '../hierarchy': { validateHierarchyInput: async () => { if (invalid) throw new Error('Rejected parent'); return current; }, allProjectIssues: async () => items },
    '../../../hierarchy': h,
    '../../project-users': { validateIssueAssignee: async () => {} },
    '../update': { saveIssueUpdate: async (id, body) => { writes.push({ url: `/api/rest/issues/${id}`, options: { method: 'PATCH', body: JSON.stringify(body) } }); return { issues: [current] }; } },
  });
  return { writes, patch: (input, id = '4') => route.PATCH({ json: async () => ({ ...input }) }, { params: Promise.resolve({ id }) }), remove: (id) => route.DELETE({}, { params: Promise.resolve({ id: String(id) }) }) };
}
test('PATCH omits empty parent for projects without a parent field, but clears linked parents', async () => {
  const unlinked = patchHarness(item(4, 'Epic'));
  assert.equal((await unlinked.patch({ parentId: '', summary: 'Updated' })).status, 200);
  assert.equal(JSON.parse(unlinked.writes[0].options.body).custom_fields, undefined);
  const linked = patchHarness(item(4, 'Epic', 3));
  assert.equal((await linked.patch({ parentId: '' })).status, 200);
  assert.equal(JSON.parse(linked.writes[0].options.body).custom_fields[0].value, '');
});
test('PATCH rejects invalid hierarchy and task IDs without mutation', async () => {
  const invalid = patchHarness(items[3], true);
  assert.equal((await invalid.patch({ parentId: '2' })).status, 500);
  assert.equal(invalid.writes.length, 0);
  const badId = patchHarness(items[3]);
  assert.equal((await badId.patch({ parentId: '2' }, 'bad')).status, 400);
  assert.equal(badId.writes.length, 0);
});

test('missing type is Unclassified and cannot masquerade as Bug', () => {
  const unknown = item(90, '');
  assert.equal(h.workType(unknown), 'Unclassified');
  assert.throws(() => h.validateParent(unknown, null, items), /explicit work-item type/);
  assert.ok(h.buildHierarchy([unknown])[0].warning);
});
test('legacy missing levels and incomplete ancestors stay visible for organization', () => {
  const legacy = [item(1, 'Epic'), item(2, 'Feature', 1), item(3, 'Task', 2)];
  const nodes = h.buildHierarchy(legacy);
  assert.equal(nodes.length, 3);
  assert.equal(nodes[0].warning, undefined);
  assert.ok(nodes[1].warning);
  assert.ok(nodes[2].warning);
  assert.throws(() => h.validateParent(item(99, 'Bug'), 3, legacy), /requires User Story/);
});
test('new items require explicit type and all required parent levels', async () => {
  const api = serverHarness();
  await assert.rejects(api.validateHierarchyInput({ project: 'Project 1' }), /explicit work-item type/);
  await assert.rejects(api.validateHierarchyInput({ project: 'Project 1', type: 'Bug' }), /requires a Task/);
  await assert.rejects(api.validateHierarchyInput({ project: 'Project 1', type: 'Feature', parentId: '1' }), /requires User Story/);
  await api.validateHierarchyInput({ project: 'Project 1', type: 'Epic' });
  await api.validateHierarchyInput({ project: 'Project 1', type: 'Bug', parentId: '4' });
});
test('deleting parents with children is rejected without writes', async () => {
  const api = patchHarness(items[0]);
  assert.equal((await api.remove(1)).status, 409);
  assert.equal(api.writes.length, 0);
  assert.equal((await api.remove(5)).status, 200);
  assert.equal(api.writes.length, 1);
});

test('hierarchy audit counts missing and malformed metadata without reclassifying', () => {
  const legacy = [item(1, 'Epic'), item(2, 'Feature', 1), item(3, '')];
  assert.equal(h.hierarchyProblems(legacy).size, 2);
  assert.equal(h.workType(legacy[2]), 'Unclassified');
  assert.equal(legacy[2].custom_fields[0].value, '');
});

test('drill-down cards expose each exact hierarchy level and contextual child creation', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { HierarchyExplorer } = load('app/hierarchy-explorer.tsx', {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), './hierarchy': h,
    './work-items': { HierarchyTree: () => null, startDrag: () => {}, draggedId: () => 0 },
    './project-api-links': { ProjectApiLinks: () => null },
    './card-details': { CardViewButton: () => null },
    './rich-content': { RichContent: ({ value }) => value },
  });
  const props = { projects: [{ id: 1, name: 'Project 1' }], items, projectId: '1', onNavigate() {}, onOverview() {}, onEdit() {}, onCreate() {}, async onChange() { return true; } };
  for (const [itemId, childId, nextType] of [[null, 1, 'Epic'], [1, 2, 'Story'], [2, 3, 'Feature'], [3, 4, 'Task'], [4, 5, 'Bug']]) {
    const html = renderToStaticMarkup(React.createElement(HierarchyExplorer, { ...props, itemId }));
    assert.ok(html.includes(`data-drill-item="${childId}"`));
    assert.ok(html.includes(`New ${nextType}`));
    assert.ok(html.includes('Hierarchy breadcrumbs'));
  }
  const bug = renderToStaticMarkup(React.createElement(HierarchyExplorer, { ...props, itemId: 5 }));
  assert.ok(bug.includes('Bug details'));
  assert.ok(bug.includes('Task #4'));
});

test('project drill-down counts unclassified items for organization instead of inventing epics', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { HierarchyExplorer } = load('app/hierarchy-explorer.tsx', {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), './hierarchy': h,
    './work-items': { HierarchyTree: () => null, startDrag: () => {}, draggedId: () => 0 },
    './project-api-links': { ProjectApiLinks: () => null },
    './card-details': { CardViewButton: () => null },
    './rich-content': { RichContent: ({ value }) => value },
  });
  const html = renderToStaticMarkup(React.createElement(HierarchyExplorer, { projects: [{ id: 1, name: 'Project 1' }], items: [item(99, '')], projectId: '', itemId: null }));
  assert.match(html, /0 epics/);
  assert.match(html, /1 need organization/);
});
