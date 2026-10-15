import { mantisFetch } from './mantis';

export async function projectHandlers(projectId: number) {
  const users: Array<{ id: number; name: string }> = [];
  for (let page = 1; ; page++) {
    const data = await mantisFetch<{ users: Array<{ id: number; name: string }> }>(`/api/rest/projects/${projectId}/handlers?page_size=100&page=${page}`);
    const batch = data.users ?? [];
    const additions = batch.filter((user) => !users.some((entry) => entry.id === user.id));
    if (batch.length && !additions.length) throw new Error('User pagination did not advance.');
    users.push(...additions.map(({ id, name }) => ({ id, name })));
    if (batch.length < 100) return users;
  }
}

export async function validateAssignee(projectId: number, assigneeId: unknown) {
  if (assigneeId === undefined) return;
  if (assigneeId === '' || assigneeId === null || assigneeId === 0 || assigneeId === '0') return;
  if (!['string', 'number'].includes(typeof assigneeId) || !/^[1-9]\d*$/.test(String(assigneeId)) || !Number.isSafeInteger(Number(assigneeId)) || !(await projectHandlers(projectId)).some((user) => user.id === Number(assigneeId))) throw new Error('Choose an eligible project assignee.');
}

export async function validateIssueAssignee(input: { assigneeId?: unknown; project?: string }, itemId?: number) {
  if (input.assigneeId === undefined) return;
  let projectId: number | undefined;
  if (input.project !== undefined) {
    const data = await mantisFetch<{ projects: Array<{ id: number; name: string }> }>('/api/rest/projects');
    projectId = data.projects.find((project) => project.name === input.project)?.id;
  } else if (itemId) {
    const data = await mantisFetch<{ issues: Array<{ project?: { id: number } }> }>(`/api/rest/issues/${itemId}`);
    projectId = data.issues?.[0]?.project?.id;
  }
  if (!projectId) throw new Error('Project not found for assignment.');
  await validateAssignee(projectId, input.assigneeId);
}
