import { hierarchyProblems, parentId, type WorkItem, type WorkNode } from './hierarchy';

export function cardDetailTree(items: WorkItem[], projectId: number, rootId: number | null = null, matchingIds?: Set<number>): WorkNode[] {
  const scoped = items.filter((item) => item.project?.id === projectId && (!matchingIds || matchingIds.has(item.id)));
  const index = new Map(scoped.map((item) => [item.id, item]));
  const children = new Map<number, WorkItem[]>();
  for (const item of scoped) {
    const parent = parentId(item);
    if (parent !== null) children.set(parent, [...(children.get(parent) ?? []), item]);
  }
  const warnings = hierarchyProblems(items);
  const visited = new Set(rootId === null ? [] : [rootId]);
  function visit(item: WorkItem): WorkNode[] {
    if (visited.has(item.id)) return [];
    visited.add(item.id);
    return [{ item, children: (children.get(item.id) ?? []).flatMap(visit), warning: warnings.get(item.id) }];
  }
  if (rootId !== null) return (children.get(rootId) ?? []).flatMap(visit);
  const roots = scoped.filter((item) => parentId(item) === null || !index.has(parentId(item)!)).flatMap(visit);
  // Keep rootless cycles and malformed links visible without recursing forever.
  for (const item of scoped) if (!visited.has(item.id)) roots.push(...visit(item));
  return roots;
}
