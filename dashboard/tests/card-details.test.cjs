const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require(name) {
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  } });
  return exports;
}
const hierarchy = load('app/hierarchy.ts');
const tree = load('app/card-details-tree.ts', { './hierarchy': hierarchy });
const jsx = require('react/jsx-runtime');
const icons = load('app/card-view-icon.tsx', { 'react/jsx-runtime': jsx });
function details(react = React) {
  return load('app/card-details.tsx', { react, 'react/jsx-runtime': jsx, './hierarchy': hierarchy, './card-details-tree': tree, './card-view-icon': icons, './rich-content': { RichContent: ({ value }) => value } });
}
function item(id, type, parent = '', projectId = 1) {
  return { id, summary: `Item ${id}`, description: `Description ${id}`, project: { id: projectId, name: `Project ${projectId}` }, status: { name: 'new' }, handler: { id: 7, name: 'Person' }, custom_fields: [
    { field: { name: 'Work Item Type' }, value: type }, { field: { name: 'Parent Issue' }, value: String(parent) },
  ] };
}
const items = [item(1, 'Epic'), item(2, 'User Story', 1), item(3, 'Feature', 2), item(4, 'Task', 3), item(5, 'Bug', 4), item(6, 'Task', 3), item(20, 'Epic', '', 2)];
const projects = [{ id: 1, name: 'Project 1', description: 'Project description', enabled: true }, { id: 2, name: 'Project 2' }];
const repositories = [{ project: 'Project 1', repoName: 'Source', provider: 'github', url: 'https://example.test/source', defaultBranch: 'main', notes: 'Repository notes' }];
function ids(nodes) { return Array.from(nodes).flatMap((node) => [node.item.id, ...ids(node.children)]); }

test('project tree includes all hierarchy levels exactly once and excludes other projects', () => {
  const nodes = tree.cardDetailTree(items, 1);
  assert.deepEqual(ids(nodes), [1, 2, 3, 4, 5, 6]);
  assert.equal(nodes[0].item.id, 1);
  assert.equal(nodes[0].children[0].children[0].item.id, 3);
});

test('selected item tree contains descendants, never the item itself or its ancestors', () => {
  assert.deepEqual(ids(tree.cardDetailTree(items, 1, 3)), [4, 5, 6]);
  assert.deepEqual(ids(tree.cardDetailTree(items, 1, 4)), [5]);
  assert.deepEqual(ids(tree.cardDetailTree(items, 1, 5)), []);
});

test('malformed links and rootless cycles stay visible without infinite recursion', () => {
  const malformed = [item(9, 'Task', 10), item(10, 'Bug', 9), item(11, 'Task', 999)];
  const nodes = tree.cardDetailTree(malformed, 1);
  assert.deepEqual(ids(nodes).sort((a, b) => a - b), [9, 10, 11]);
  assert.ok(nodes.every((node) => node.warning));
  assert.deepEqual(ids(tree.cardDetailTree(malformed, 1, 9)), [10]);
});

test('filtered summary trees do not invent ancestry or mark valid filtered roots malformed', () => {
  const nodes = tree.cardDetailTree(items, 1, null, new Set([4, 5]));
  assert.deepEqual(ids(nodes), [4, 5]);
  assert.equal(nodes[0].warning, undefined);
});

test('eye action targets its own card and stops the card drill-down click', () => {
  let selected, stopped = 0;
  const { CardViewButton } = details({ ...React, useContext: () => (target) => { selected = target; } });
  const target = { kind: 'item', id: 3 };
  const button = CardViewButton({ target, label: 'Feature #3' });
  assert.equal(button.props['aria-haspopup'], 'dialog');
  assert.equal(button.props.title, 'View details: Feature #3');
  button.props.onClick({ stopPropagation() { stopped++; } });
  assert.equal(selected, target);
  assert.equal(stopped, 1);
});

function renderTarget(target) {
  const { CardDetailsProvider } = details({ ...React, useState: () => [target, () => {}] });
  return renderToStaticMarkup(React.createElement(CardDetailsProvider, { projects, items, repositories }, null));
}

test('eye viewer shows the selected item details before the separate descendant hierarchy', () => {
  const html = renderTarget({ kind: 'item', id: 3 });
  assert.ok(html.includes('Feature #3: Item 3'));
  assert.ok(html.includes('Description 3'));
  assert.ok(html.includes('Person'));
  assert.ok(!html.includes('Description 4'));
  assert.ok(html.indexOf('Description 3') < html.indexOf('aria-label="Descendant hierarchy"'));
  const parentSection = html.split('aria-label="Parent item"')[1].split('</nav>')[0];
  assert.ok(parentSection.includes('#2 Item 2'));
  assert.ok(parentSection.includes('<button'));
  assert.ok(html.includes('<details open="">'));
  assert.ok(html.includes('#5 Item 5'));
});

test('each child view shows its actual parent; epic roots show their project', () => {
  for (const [id, parent] of [[2, '#1 Item 1'], [3, '#2 Item 2'], [4, '#3 Item 3'], [5, '#4 Item 4']]) {
    const html = renderTarget({ kind: 'item', id });
    assert.ok(html.split('aria-label="Parent item"')[1].split('</nav>')[0].includes(parent));
  }
  assert.ok(renderTarget({ kind: 'item', id: 1 }).split('aria-label="Parent item"')[1].split('</nav>')[0].includes('Project 1'));
  assert.ok(renderTarget({ kind: 'item', id: 5 }).includes('No child items.'));
});

test('project, repository and summary views show their own details', () => {
  const project = renderTarget({ kind: 'project', id: 1 });
  assert.ok(project.includes('Project description'));
  assert.ok(project.includes('#5 Item 5'));
  const repository = renderTarget({ kind: 'repository', project: 'Project 1', repoName: 'Source' });
  assert.ok(repository.includes('Repository notes'));
  assert.ok(repository.includes('https://example.test/source'));
  assert.ok(repository.split('aria-label="Parent item"')[1].split('</nav>')[0].includes('Project 1'));
  const summary = renderTarget({ kind: 'summary', title: 'Testing report', fields: [{ name: 'Matching items', value: 2 }], itemIds: [4, 5] });
  assert.ok(summary.includes('Testing report'));
  assert.ok(summary.includes('Matching items'));
  assert.ok(summary.includes('#4 Item 4'));
});
