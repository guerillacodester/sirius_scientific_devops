export type WorkItem = {
  id: number;
  summary: string;
  description?: string;
  project?: { id: number; name: string };
  status?: { name: string };
  handler?: { id?: number; name: string };
  custom_fields?: Array<{ field?: { name?: string }; value?: string }>;
};

export function workField(item: WorkItem, name: string) {
  return item.custom_fields?.find((entry) => entry.field?.name === name)?.value ?? '';
}

export function workType(item: WorkItem) {
  return workField(item, 'Work Item Type') || 'Unclassified';
}

export function parentId(item: WorkItem) {
  const value = Number(workField(item, 'Parent Issue'));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function requiredParentType(type: string): string | null | undefined {
  if (type === 'Epic') return null;
  return ({ 'User Story': 'Epic', Feature: 'User Story', Task: 'Feature', Bug: 'Task', Improvement: 'Feature', 'Technical Debt': 'Feature' } as Record<string, string>)[type];
}

export function assertParent(child: WorkItem, parent: WorkItem) {
  if (child.id === parent.id) throw new Error('An item cannot be its own parent.');
  if (!child.project || !parent.project || child.project.id !== parent.project.id) {
    throw new Error('Parent and child must belong to the same project.');
  }
  const required = requiredParentType(workType(child));
  if (required === undefined) throw new Error('Choose an explicit work-item type.');
  if (required === null || workType(parent) !== required) {
    throw new Error(`${workType(child)} requires ${required ?? 'no'} parent. Use Epic > Story > Feature > Task > Bug.`);
  }
}

export function validateParent(child: WorkItem, targetId: number | null, items: WorkItem[]) {
  if (targetId === child.id) throw new Error('An item cannot be its own parent.');
  const required = requiredParentType(workType(child));
  if (required === undefined) throw new Error('Choose an explicit work-item type.');
  if (targetId === null) {
    if (required !== null) throw new Error(`${workType(child)} requires a ${required} parent.`);
    return;
  }
  const index = new Map(items.map((item) => [item.id, item]));
  const parent = index.get(targetId);
  if (!parent) throw new Error('Parent is unavailable. Refresh the project before linking.');
  const visited = new Set([child.id]);
  const chain = [child];
  let ancestor: WorkItem | undefined = parent;
  while (ancestor) {
    if (visited.has(ancestor.id)) throw new Error('Parent link would create a cycle.');
    visited.add(ancestor.id);
    chain.push(ancestor);
    const next = parentId(ancestor);
    if (next === null) break;
    ancestor = index.get(next);
    if (!ancestor) throw new Error('An ancestor is unavailable. Repair its parent link first.');
  }
  for (let i = 0; i < chain.length - 1; i++) assertParent(chain[i], chain[i + 1]);
  const root = chain[chain.length - 1];
  if (requiredParentType(workType(root)) !== null) throw new Error(`Ancestor #${root.id} has an incomplete parent chain.`);
}

export type WorkNode = { item: WorkItem; children: WorkNode[]; warning?: string };

export function hierarchyProblems(items: WorkItem[]) {
  return new Map(items.flatMap((item) => {
    try { validateParent(item, parentId(item), items); return []; }
    catch (error) { return [[item.id, String(error).replace(/^Error: /, '')] as const]; }
  }));
}

export function buildHierarchy(items: WorkItem[]): WorkNode[] {
  const nodes = new Map(items.map((item) => [item.id, { item, children: [] } as WorkNode]));
  const roots: WorkNode[] = [];
  for (const node of nodes.values()) {
    const target = parentId(node.item);
    try {
      validateParent(node.item, target, items);
      if (target === null) roots.push(node);
      else nodes.get(target)!.children.push(node);
    } catch (error) {
      node.warning = String(error).replace(/^Error: /, '');
      roots.push(node);
    }
  }
  return roots;
}

export function filterHierarchy(nodes: WorkNode[], matchingIds: Set<number>): WorkNode[] {
  return nodes.flatMap((node) => {
    const children = filterHierarchy(node.children, matchingIds);
    return matchingIds.has(node.item.id) || children.length ? [{ ...node, children }] : [];
  });
}

export function reorderItems(order: number[], movingId: number, beforeId?: number) {
  if (movingId === beforeId) return order;
  const next = order.filter((id) => id !== movingId);
  const index = beforeId === undefined ? -1 : next.indexOf(beforeId);
  next.splice(index < 0 ? next.length : index, 0, movingId);
  return next;
}
