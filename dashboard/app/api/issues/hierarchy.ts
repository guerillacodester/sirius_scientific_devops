import { mantisFetch } from '../mantis';
import { assertParent, parentId, validateParent, workType, type WorkItem } from '../../hierarchy';

type HierarchyInput = { parentId?: string | number; type?: string; project?: string };

export async function allProjectIssues(projectId?: string) {
  const items: WorkItem[] = [];
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({ page_size: '100', page: String(page) });
    if (projectId) params.set('project_id', projectId);
    const data = await mantisFetch<{ issues: WorkItem[] }>(`/api/rest/issues?${params}`);
    const batch = data.issues ?? [];
    const known = new Set(items.map((item) => item.id));
    if (batch.length && batch.every((item) => known.has(item.id))) {
      throw new Error('Mantis pagination did not advance. Refresh before changing hierarchy.');
    }
    items.push(...batch.filter((item) => !known.has(item.id)));
    if (batch.length < 100) return items;
  }
}

export async function validateHierarchyInput(input: HierarchyInput, id?: number) {
  if (id && input.parentId === undefined && input.type === undefined && input.project === undefined) return;
  if (input.parentId !== undefined && input.parentId !== '' &&
      (!/^[1-9]\d*$/.test(String(input.parentId)) || !Number.isSafeInteger(Number(input.parentId)))) {
    throw new Error('Parent ID must be a positive integer or empty.');
  }
  const current = id ? (await mantisFetch<{ issues: WorkItem[] }>(`/api/rest/issues/${id}`)).issues[0] : undefined;
  if (id && !current) throw new Error('Work item not found.');
  let project = current?.project;
  if (input.project !== undefined && project?.name !== input.project) {
    const data = await mantisFetch<{ projects: Array<{ id: number; name: string }> }>('/api/rest/projects');
    project = data.projects.find((entry) => entry.name === input.project);
    if (!project) throw new Error('Project not found.');
  }
  const target = input.parentId === undefined ? (current ? parentId(current) : null)
    : input.parentId === '' ? null : Number(input.parentId);
  const fields = [...(current?.custom_fields ?? [])].filter((entry) => entry.field?.name !== 'Work Item Type');
  if (input.type !== undefined) fields.push({ field: { name: 'Work Item Type' }, value: input.type });
  else if (current) fields.push(...(current.custom_fields ?? []).filter((entry) => entry.field?.name === 'Work Item Type'));
  const child: WorkItem = { id: id ?? 0, summary: current?.summary ?? '', project, custom_fields: fields };
  const ancestors: WorkItem[] = [];
  const visited = new Set([child.id]);
  let next = target;
  while (next !== null) {
    if (visited.has(next)) throw new Error('Parent link would create a cycle.');
    visited.add(next);
    const data = await mantisFetch<{ issues: WorkItem[] }>(`/api/rest/issues/${next}`);
    const ancestor = data.issues.find((item) => item.id === next);
    if (!ancestor) throw new Error('Parent or ancestor not found.');
    ancestors.push(ancestor);
    next = parentId(ancestor);
  }
  validateParent(child, target, ancestors);
  if (current && ((input.type !== undefined && input.type !== workType(current)) || (input.project !== undefined && input.project !== current.project?.name))) {
    const children = (await allProjectIssues(String(current.project?.id))).filter((item) => parentId(item) === id);
    for (const item of children) assertParent(item, child);
  }
  return current;
}
