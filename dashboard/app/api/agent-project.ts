import { agentAccess, type AgentRole } from './agent-access';
import { mantisFetch } from './mantis';
import { allProjectIssues, validateHierarchyInput } from './issues/hierarchy';
import { issuePayload } from './issues/payload';
import { saveIssueUpdate } from './issues/update';
import { projectHandlers, validateAssignee } from './project-users';
import { projectBridge } from './project-bridge';
import { normalizeRepo, readRegistry, writeRegistry } from './repos/store';
import { buildHierarchy, parentId, workField, workType, type WorkItem } from '../hierarchy';
import { agentGuide, projectOpenApi } from './agent-docs';

export const agentTypes = ['Epic', 'User Story', 'Feature', 'Task', 'Bug', 'Improvement', 'Technical Debt'];
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
function fail(status: number, code: string, message: string): never { throw new ApiError(status, code, message); }
function id(value: unknown, label = 'ID') {
  if (!['string', 'number'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail(400, 'invalid_id', `${label} must be a positive integer.`);
  return Number(value);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'invalid_body', 'Send a JSON object.');
  return value as Record<string, unknown>;
}
function only(input: Record<string, unknown>, keys: string[]) {
  for (const key of Object.keys(input)) if (!keys.includes(key)) fail(400, 'unknown_field', `Unsupported field: ${key}`);
}
function text(value: unknown, label: string, blank = false): string {
  if (typeof value !== 'string' || (!blank && !value.trim()) || value.length > 100000) fail(400, 'invalid_field', `${label} must be ${blank ? 'a' : 'a non-empty'} string (maximum 100000 characters).`);
  return value as string;
}
function permit(role: AgentRole, needed: 'write' | 'owner') {
  if (role === 'reader' || (needed === 'owner' && role !== 'owner')) fail(403, 'insufficient_role', `${needed === 'owner' ? 'Owner' : 'Editor or owner'} access is required.`);
}
const itemFields = ['summary', 'description', 'category', 'type', 'status', 'parentId', 'assigneeId', 'sprint', 'storyPoints', 'deviceInfo', 'appVersion', 'osVersion', 'logs', 'verification', 'releaseReadiness'];
function itemInput(body: unknown, creating: boolean) {
  const input = { ...object(body) };
  only(input, itemFields);
  for (const field of itemFields.filter((key) => !['parentId', 'assigneeId', 'storyPoints'].includes(key))) {
    if (input[field] !== undefined) text(input[field], field, !['summary', 'description', 'category', 'type', 'status'].includes(field));
  }
  if (input.type !== undefined && !agentTypes.includes(String(input.type))) fail(400, 'invalid_type', 'Choose a supported work-item type.');
  if (input.parentId !== undefined) input.parentId = input.parentId === null ? '' : String(id(input.parentId, 'Parent ID'));
  if (input.assigneeId !== undefined) input.assigneeId = input.assigneeId === null ? '' : String(id(input.assigneeId, 'Assignee ID'));
  if (input.storyPoints !== undefined && (input.storyPoints === null || !['string', 'number'].includes(typeof input.storyPoints) || !Number.isFinite(Number(input.storyPoints)) || Number(input.storyPoints) < 0)) fail(400, 'invalid_field', 'Story points must be a non-negative number.');
  if (creating) for (const field of ['summary', 'description', 'category', 'type']) text(input[field], field);
  if (!Object.keys(input).length) fail(400, 'empty_update', 'At least one field is required.');
  return input;
}
type NativeItem = WorkItem & {
  handler?: { id?: number; name: string }; category?: { id?: number; name: string };
  notes?: Array<{ id: number; text: string; reporter?: { id: number; name: string }; created_at?: string; updated_at?: string }>;
  updated_at?: string; created_at?: string;
};
export function agentItem(item: NativeItem) {
  return { id: item.id, summary: item.summary, description: item.description ?? '', projectId: item.project?.id,
    type: workType(item), parentId: parentId(item), assignee: item.handler?.id ? { id: item.handler.id, name: item.handler.name } : null,
    status: item.status?.name ?? null, category: item.category?.name ?? null,
    sprint: workField(item, 'Sprint'), storyPoints: workField(item, 'Story Points'),
    deviceInfo: workField(item, 'Device Information'), appVersion: workField(item, 'Application Version'), osVersion: workField(item, 'Operating System Version'),
    logs: workField(item, 'Relevant Logs'), verification: workField(item, 'Verification Result'), releaseReadiness: workField(item, 'Release Readiness'),
    createdAt: item.created_at, updatedAt: item.updated_at };
}
function page<T>(records: T[], params: URLSearchParams) {
  const number = params.has('page') ? id(params.get('page'), 'Page') : 1;
  const limit = params.has('limit') ? id(params.get('limit'), 'Limit') : 50;
  if (limit > 100) fail(400, 'invalid_limit', 'Limit cannot exceed 100.');
  return { data: records.slice((number - 1) * limit, number * limit), page: number, limit, total: records.length, hasMore: number * limit < records.length };
}
const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: noStore });

export async function projectAgentRequest(request: Request, project: string, segments: string[] = []) {
  try {
    const projectId = id(project, 'Project ID');
    const url = new URL(request.url);
    const base = `${url.origin}/api/v1/projects/${projectId}`;
    if (request.method === 'GET' && segments.length === 1 && segments[0] === 'openapi.json') return json(projectOpenApi(base));
    if (request.method === 'GET' && segments.length === 1 && segments[0] === 'guide') return new Response(agentGuide(base), { headers: { ...noStore, 'Content-Type': 'text/markdown; charset=utf-8' } });
    const authorization = request.headers.get('authorization') ?? '';
    const credential = await agentAccess.authenticate(projectId, authorization.match(/^Bearer (\S+)$/i)?.[1] ?? '');
    if (!credential) return json({ error: { code: 'unauthorized', message: 'A valid credential for this project is required.' }, documentation: `${base}/guide`, openapi: `${base}/openapi.json` }, 401);
    if (request.method !== 'GET') permit(credential.role, 'write');
    const projects = await mantisFetch<{ projects: Array<{ id: number; name: string; description?: string; enabled?: boolean; status?: { name: string }; view_state?: { name: string }; categories?: Array<{ id: number; name: string }> }> }>(`/api/rest/projects/${projectId}`);
    const currentProject = projects.projects?.find((entry) => entry.id === projectId);
    if (!currentProject) fail(404, 'not_found', 'Project not found.');
    const records = async () => (await allProjectIssues(String(projectId))).filter((entry) => entry.project?.id === projectId);
    async function readItem(itemId: number): Promise<NativeItem> {
      const result = await mantisFetch<{ issues: NativeItem[] }>(`/api/rest/issues/${itemId}`);
      const item = result.issues?.find((entry) => entry.id === itemId && entry.project?.id === projectId);
      if (!item) fail(404, 'not_found', 'Work item not found in this project.');
      return item;
    }
    async function patchItem(itemId: number, input: ReturnType<typeof itemInput>) {
      const current = await readItem(itemId);
      if (input.parentId) await readItem(Number(input.parentId));
      await validateAssignee(projectId, input.assigneeId);
      await validateHierarchyInput({ ...input, project: currentProject!.name }, itemId);
      if (input.parentId === '' && parentId(current) === null) delete input.parentId;
      await saveIssueUpdate(itemId, issuePayload(input, true, true), current);
      return json({ item: agentItem(await readItem(itemId)) });
    }
    if (!segments.length) {
      if (request.method === 'GET') return json({ project: { id: projectId, name: currentProject.name, description: currentProject.description ?? '', enabled: currentProject.enabled, status: currentProject.status?.name, visibility: currentProject.view_state?.name }, links: { self: base, items: `${base}/items`, hierarchy: `${base}/hierarchy`, users: `${base}/users`, metadata: `${base}/metadata`, repositories: `${base}/repositories`, guide: `${base}/guide`, openapi: `${base}/openapi.json` } });
      permit(credential.role, 'owner');
      if (request.method === 'PATCH') {
        const input = object(await request.json()); only(input, ['name', 'description', 'enabled', 'status', 'visibility']);
        const body: Record<string, unknown> = {};
        for (const key of ['name', 'description']) if (input[key] !== undefined) body[key] = text(input[key], key, key === 'description');
        if (input.enabled !== undefined) { if (typeof input.enabled !== 'boolean') fail(400, 'invalid_field', 'enabled must be boolean.'); body.enabled = input.enabled; }
        if (input.status !== undefined) body.status = { name: text(input.status, 'status') };
        if (input.visibility !== undefined) { if (!['public', 'private'].includes(String(input.visibility))) fail(400, 'invalid_field', 'Visibility must be public or private.'); body.view_state = { name: input.visibility }; }
        if (!Object.keys(body).length) fail(400, 'empty_update', 'At least one field is required.');
        if (body.name !== undefined && body.name !== currentProject.name && (await readRegistry()).repositories.some((repo) => repo.project === currentProject.name)) fail(409, 'linked_repositories', 'Remove repository mappings before renaming the project.');
        await mantisFetch(`/api/rest/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify(body) });
        return json({ updated: { projectId } });
      }
      if (request.method === 'DELETE') {
        if ((await records()).length || (await readRegistry()).repositories.some((repo) => repo.project === currentProject.name)) fail(409, 'project_not_empty', 'Remove work items and repository mappings before deleting this project.');
        await mantisFetch(`/api/rest/projects/${projectId}`, { method: 'DELETE' }); return json({ removed: { projectId } });
      }
    }
    if (segments.length === 1 && request.method === 'GET') {
      if (segments[0] === 'users') return json(page(await projectHandlers(projectId), url.searchParams));
      if (segments[0] === 'metadata') {
        const config = await mantisFetch<{ configs: Array<{ option: string; value: Array<{ id: number; name: string; label?: string }> }> }>(`/api/rest/config?option=status_enum_string&project_id=${projectId}`);
        const statuses = (config.configs.find((entry) => entry.option === 'status_enum_string')?.value ?? []).map(({ id, name, label }) => ({ id, name, label }));
        return json({ types: agentTypes, statuses, categories: (currentProject.categories ?? []).map(({ id, name }) => ({ id, name })), itemFields, hierarchy: 'Epic > User Story > Feature > Task > Bug', assignees: `${base}/users` });
      }
      if (segments[0] === 'hierarchy') {
        const normalize = (nodes: ReturnType<typeof buildHierarchy>): unknown[] => nodes.map((node) => ({ item: agentItem(node.item), ...(node.warning ? { warning: node.warning } : {}), children: normalize(node.children) }));
        return json({ roots: normalize(buildHierarchy(await records())) });
      }
    }
    if (segments[0] === 'items') {
      if (segments.length === 1) {
        if (request.method === 'GET') {
          for (const key of url.searchParams.keys()) if (!['type', 'status', 'assigneeId', 'parentId', 'q', 'page', 'limit'].includes(key)) fail(400, 'unknown_filter', `Unsupported filter: ${key}`);
          const params = url.searchParams;
          if (params.has('type') && !agentTypes.includes(params.get('type')!)) fail(400, 'invalid_type', 'Choose a supported work-item type.');
          for (const key of ['parentId', 'assigneeId']) if (params.has(key) && params.get(key) !== 'null') id(params.get(key), key);
          const filtered = (await records()).map(agentItem).filter((item) => (!params.has('type') || item.type === params.get('type')) && (!params.has('status') || item.status === params.get('status')) && (!params.has('parentId') || String(item.parentId) === params.get('parentId')) && (!params.has('assigneeId') || String(item.assignee?.id ?? null) === params.get('assigneeId')) && (!params.has('q') || `${item.id} ${item.summary} ${item.description}`.toLowerCase().includes(params.get('q')!.toLowerCase())));
          return json(page(filtered, params));
        }
        if (request.method === 'POST') {
          const input = itemInput(await request.json(), true);
          if (input.parentId) await readItem(Number(input.parentId));
          await validateAssignee(projectId, input.assigneeId);
          await validateHierarchyInput({ ...input, project: currentProject.name });
          await projectBridge({ operation: 'configure', projectId });
          const result = await mantisFetch<{ issue?: { id: number }; issues?: Array<{ id: number }> }>('/api/rest/issues', { method: 'POST', body: JSON.stringify(issuePayload({ ...input, project: currentProject.name })) });
          const created = result.issue?.id ?? result.issues?.[0]?.id;
          if (!created) fail(502, 'upstream_response', 'Mantis did not return the created item ID. Do not retry blindly; search the project first.');
          return json({ item: agentItem(await readItem(created)) }, 201);
        }
      } else {
        const itemId = id(segments[1], 'Work item ID');
        const current = await readItem(itemId);
        if (segments.length === 2) {
          if (request.method === 'GET') return json({ item: agentItem(current) });
          if (request.method === 'PATCH') return await patchItem(itemId, itemInput(await request.json(), false));
          if (request.method === 'DELETE') {
            if ((await records()).some((item) => parentId(item) === itemId)) fail(409, 'has_children', 'Move or remove child items before deleting their parent.');
            await mantisFetch(`/api/rest/issues/${itemId}`, { method: 'DELETE' }); return json({ removed: { id: itemId } });
          }
        }
        if (segments.length === 3 && segments[2] === 'children') {
          if (request.method === 'GET') return json(page((await records()).filter((item) => parentId(item) === itemId).map(agentItem), url.searchParams));
          if (request.method === 'POST') {
            const input = object(await request.json()); only(input, ['childId']);
            return await patchItem(id(input.childId, 'Child ID'), { parentId: String(itemId) });
          }
        }
        if (segments[2] === 'comments' && segments.length <= 4) {
          const notes = (current.notes ?? []).map(({ id, text, reporter, created_at, updated_at }) => ({ id, text, author: reporter ? { id: reporter.id, name: reporter.name } : null, createdAt: created_at, updatedAt: updated_at }));
          if (segments.length === 3) {
            if (request.method === 'GET') return json(page(notes, url.searchParams));
            if (request.method === 'POST') {
              const input = object(await request.json()); only(input, ['text']); text(input.text, 'text');
              const result = await mantisFetch<{ note?: { id: number } }>(`/api/rest/issues/${itemId}/notes`, { method: 'POST', body: JSON.stringify({ text: input.text, view_state: { name: 'private' } }) });
              return json({ comment: { id: result.note?.id, text: input.text } }, 201);
            }
          } else {
            const noteId = id(segments[3], 'Comment ID');
            const note = notes.find((entry) => entry.id === noteId);
            if (!note) fail(404, 'not_found', 'Comment not found on this work item.');
            if (request.method === 'GET') return json({ comment: note });
            if (request.method === 'PATCH') {
              const input = object(await request.json()); only(input, ['text']); text(input.text, 'text');
              await projectBridge({ operation: 'note-update', projectId, itemId, noteId, text: input.text as string });
              return json({ comment: { ...note, text: input.text } });
            }
            if (request.method === 'DELETE') { await mantisFetch(`/api/rest/issues/${itemId}/notes/${noteId}`, { method: 'DELETE' }); return json({ removed: { id: noteId } }); }
          }
        }
      }
    }
    if (segments[0] === 'repositories' && segments.length <= 2) {
      const registry = await readRegistry();
      const entries = registry.repositories.filter((repo) => repo.project === currentProject.name);
      const found = entries.find((entry) => entry.repoName === segments[1]);
      if (request.method === 'GET') {
        if (segments.length === 1) return json(page(entries, url.searchParams));
        if (!found) fail(404, 'not_found', 'Repository not found in this project.');
        return json({ repository: found });
      }
      permit(credential.role, 'owner');
      if (request.method === 'POST' && segments.length === 1 || request.method === 'PATCH' && segments.length === 2) {
        if (request.method === 'PATCH' && !found) fail(404, 'not_found', 'Repository not found in this project.');
        const input = object(await request.json()); only(input, ['repoName', 'provider', 'url', 'defaultBranch', 'localPath', 'notes']);
        for (const key of Object.keys(input)) text(input[key], key, ['localPath', 'notes'].includes(key));
        const entry = normalizeRepo({ ...found, ...input, project: currentProject.name });
        if (entries.some((existing) => existing !== found && existing.repoName === entry.repoName)) fail(409, 'duplicate_repository', 'Repository name already exists in this project.');
        if (found) registry.repositories[registry.repositories.indexOf(found)] = entry; else registry.repositories.push(entry);
        await writeRegistry(registry); return json({ repository: entry }, found ? 200 : 201);
      }
      if (request.method === 'DELETE' && found) {
        registry.repositories = registry.repositories.filter((entry) => entry !== found); await writeRegistry(registry); return json({ removed: { repoName: found.repoName } });
      }
      if (request.method === 'DELETE' && segments.length === 2) fail(404, 'not_found', 'Repository not found in this project.');
    }
    fail(405, 'unsupported_operation', 'This resource or HTTP method is not supported. Read the project OpenAPI document.');
  } catch (error) {
    if (error instanceof ApiError) return json({ error: { code: error.code, message: error.message } }, error.status);
    if (error instanceof SyntaxError) return json({ error: { code: 'invalid_json', message: 'Send valid JSON.' } }, 400);
    const upstreamStatus = error && typeof error === 'object' ? (error as { status?: number }).status : undefined;
    if (upstreamStatus === 404) return json({ error: { code: 'not_found', message: 'Resource not found in this project.' } }, 404);
    if (upstreamStatus === 400 || upstreamStatus === 409) return json({ error: { code: 'upstream_rejected', message: 'Mantis rejected the update. Check configured categories, statuses, custom-field options and current record state.' } }, upstreamStatus);
    const message = error instanceof Error ? error.message : '';
    if (/requires |parent|ancestor|cycle|assignee|explicit work-item type/i.test(message) && !message.startsWith('Mantis')) return json({ error: { code: 'validation_failed', message } }, 400);
    return json({ error: { code: 'upstream_failure', message: 'Mantis or local storage could not complete the request. Read current state before retrying a write.' } }, 502);
  }
}
