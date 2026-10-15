import { mantisFetch } from '../mantis';
import { projectBridge } from '../project-bridge';
import { workType, type WorkItem } from '../../hierarchy';

const planningTypes = ['Epic', 'User Story', 'Feature', 'Task', 'Improvement', 'Technical Debt'];

// Call only after hierarchy and assignee validation; never fabricate a description.
export async function saveIssueUpdate(id: number, body: Record<string, unknown>, known?: WorkItem) {
  const current = known ?? (await mantisFetch<{ issues: WorkItem[] }>(`/api/rest/issues/${id}`)).issues?.find((item) => item.id === id);
  if (!current) throw new Error('Work item not found.');
  if (typeof current.description === 'string' && !current.description.trim() && planningTypes.includes(workType(current)) && body.description === undefined) {
    if (!current.project?.id) throw new Error('Project is unavailable.');
    const project = body.project as { name?: string } | undefined;
    if (project && project.name !== current.project.name) throw new Error('Add a description before moving a title-only item between projects.');
    const { project: _project, ...payload } = body;
    await projectBridge({ operation: 'planning-update', projectId: current.project.id, itemId: id, payload });
    return mantisFetch(`/api/rest/issues/${id}`);
  }
  return mantisFetch(`/api/rest/issues/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}
