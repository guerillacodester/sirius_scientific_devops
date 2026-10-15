const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPlan } = require('../../scripts/workitem-reorganization-plan.cjs');
function fixture() {
  const groups = [
    [6, [16, ...Array.from({ length: 12 }, (_, i) => i + 17), 47]],
    [12, Array.from({ length: 11 }, (_, i) => i + 50)],
    [1, [...Array.from({ length: 13 }, (_, i) => i + 1), 49]],
    [13, [61]],
  ];
  return { issues: groups.flatMap(([projectId, ids]) => ids.map((id) => ({ id, summary: `Original ${id}`, description: `Original description ${id}`, project: { id: projectId } }))) };
}
test('classifies every original exactly once while retaining titles and input contents', () => {
  const original = fixture();
  const before = JSON.stringify(original);
  const plan = buildPlan(original);
  assert.equal(plan.nodes.length, 97);
  assert.equal(plan.nodes.filter((node) => node.id).length, 40);
  assert.equal(JSON.stringify(original), before);
  for (const entry of original.issues) assert.equal(plan.nodes.find((node) => node.id === entry.id).title, entry.summary);
});
test('all planned chains are complete, same-project, acyclic, and parent-first', () => {
  const plan = buildPlan(fixture());
  const seen = new Map();
  const required = { Epic: null, 'User Story': 'Epic', Feature: 'User Story', Task: 'Feature', Bug: 'Task' };
  for (const node of plan.nodes) {
    if (node.type === 'Epic') assert.equal(node.parent, null);
    else {
      const parent = seen.get(node.parent);
      assert.ok(parent);
      assert.equal(parent.type, required[node.type]);
      assert.equal(parent.projectId, node.projectId);
    }
    seen.set(node.key, node);
  }
});
test('all inferred scaffolds have blank descriptions; mixed and defect records retain meaningful types', () => {
  const plan = buildPlan(fixture());
  assert.ok(plan.nodes.filter((node) => !node.id).every((node) => node.description === ''));
  for (const [id, type] of [[9, 'Feature'], [11, 'Task'], [12, 'Task'], [13, 'Task'], [1, 'Bug'], [50, 'Epic'], [51, 'Task'], [61, 'Task']]) {
    assert.equal(plan.nodes.find((node) => node.id === id).type, type);
  }
});
test('unexpected or missing originals fail rather than silently skipping work', () => {
  const missing = fixture(); missing.issues = missing.issues.filter((item) => item.id !== 61);
  assert.throws(() => buildPlan(missing), /Missing/);
  const extra = fixture(); extra.issues.push({ id: 999, summary: 'Unexpected', project: { id: 1 } });
  assert.throws(() => buildPlan(extra), /exactly once/);
});
