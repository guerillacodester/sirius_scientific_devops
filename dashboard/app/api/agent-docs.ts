const types = ['Epic', 'User Story', 'Feature', 'Task', 'Bug', 'Improvement', 'Technical Debt'];
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const string = { type: 'string' };
const identifier = { type: 'integer', minimum: 1 };
const nullableId = { type: 'integer', minimum: 1, nullable: true };
const paginated = [{ name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } }, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } }];
const itemProperties = {
  summary: { ...string, minLength: 1 }, description: { ...string, minLength: 1 }, category: { ...string, minLength: 1 },
  type: { type: 'string', enum: types }, status: string,
  parentId: { ...nullableId, description: 'Required parent for every type except Epic; null denotes an Epic project root.' },
  assigneeId: { ...nullableId, description: 'Eligible ID from /users; null explicitly unassigns. Omission leaves assignment unchanged on PATCH.' },
  sprint: string, storyPoints: { oneOf: [{ type: 'number', minimum: 0 }, string] }, deviceInfo: string,
  appVersion: string, osVersion: string, logs: string, verification: string, releaseReadiness: string,
};

export function projectOpenApi(base: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  function operation(path: string, method: string, summary: string, options: { body?: string; parameters?: unknown[]; role?: string; success?: number; public?: boolean; response?: string } = {}) {
    const parameters = [...Array.from(path.matchAll(/\{(\w+)\}/g), ([, name]) => ({ name, in: 'path', required: true, schema: name === 'repoName' ? string : identifier })), ...(options.parameters ?? [])];
    paths[path] ??= {};
    paths[path][method] = {
      operationId: `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`, summary,
      description: options.public ? 'Public schema/instructions only. No project data or credentials.' : `Required role: ${options.role ?? (method === 'get' ? 'reader, editor, or owner' : 'editor or owner')}. Project scope is fixed by the URL and credential.`,
      security: options.public ? [] : [{ ProjectBearer: [] }], parameters,
      ...(options.body ? { requestBody: { required: true, content: { 'application/json': { schema: ref(options.body) } } } } : {}),
      responses: {
        [options.success ?? 200]: { description: 'Success', content: { [path === '/guide' ? 'text/markdown' : 'application/json']: { schema: options.response ? ref(options.response) : { type: 'object' } } } },
        ...Object.fromEntries([400, 401, 403, 404, 405, 409, 502].map((code) => [code, { description: ({ 400: 'Invalid input or hierarchy', 401: 'Missing, expired, revoked, or wrong-project credential', 403: 'Role not permitted', 404: 'Resource not found in this project', 405: 'Unsupported operation', 409: 'Non-empty parent/project or duplicate repository', 502: 'Upstream/storage failure: read current state before retrying writes' } as Record<number, string>)[code], content: { 'application/json': { schema: ref('Error') } } }])),
      },
    };
  }
  operation('/', 'get', 'Read project and discover resource URLs', { response: 'ProjectResult' });
  operation('/', 'patch', 'Update project metadata', { body: 'ProjectUpdate', role: 'owner' });
  operation('/', 'delete', 'Delete an empty project', { role: 'owner' });
  operation('/metadata', 'get', 'Discover configured statuses, categories, supported work-item types and writable fields');
  operation('/users', 'get', 'List eligible assignees', { parameters: paginated, response: 'UserPage' });
  operation('/hierarchy', 'get', 'Read complete Epic > Story > Feature > Task > Bug tree', { response: 'HierarchyResult' });
  operation('/items', 'get', 'Search and filter work items', { response: 'ItemPage', parameters: [...paginated,
    ...['type', 'status', 'q', 'parentId', 'assigneeId'].map((name) => ({ name, in: 'query', description: ['parentId', 'assigneeId'].includes(name) ? 'Positive ID, or literal null for roots/unassigned' : name === 'type' ? 'Exact work-item type; use User Story for stories' : 'Exact status, or case-insensitive q text search', schema: name === 'type' ? { type: 'string', enum: types } : string }))] });
  operation('/items', 'post', 'Create a typed work item', { body: 'ItemCreate', success: 201, response: 'ItemResult' });
  operation('/items/{itemId}', 'get', 'Read a work item', { response: 'ItemResult' });
  operation('/items/{itemId}', 'patch', 'Update fields, assignee, status, or parent', { body: 'ItemUpdate', response: 'ItemResult' });
  operation('/items/{itemId}', 'delete', 'Delete a work item without children');
  operation('/items/{itemId}/children', 'get', 'List immediate children', { parameters: paginated, response: 'ItemPage' });
  operation('/items/{itemId}/children', 'post', 'Move an existing child under this item', { body: 'ChildLink', response: 'ItemResult' });
  operation('/items/{itemId}/comments', 'get', 'List comments', { parameters: paginated, response: 'CommentPage' });
  operation('/items/{itemId}/comments', 'post', 'Create a private Mantis comment', { body: 'CommentInput', success: 201, response: 'CommentResult' });
  operation('/items/{itemId}/comments/{commentId}', 'get', 'Read a comment', { response: 'CommentResult' });
  operation('/items/{itemId}/comments/{commentId}', 'patch', 'Edit comment text without replacing its identity', { body: 'CommentInput', response: 'CommentResult' });
  operation('/items/{itemId}/comments/{commentId}', 'delete', 'Delete a comment');
  operation('/repositories', 'get', 'List repository mappings', { parameters: paginated, response: 'RepositoryPage' });
  operation('/repositories', 'post', 'Create a repository mapping', { body: 'RepositoryCreate', role: 'owner', success: 201, response: 'RepositoryResult' });
  operation('/repositories/{repoName}', 'get', 'Read repository mapping', { response: 'RepositoryResult' });
  operation('/repositories/{repoName}', 'patch', 'Update repository mapping', { body: 'RepositoryUpdate', role: 'owner', response: 'RepositoryResult' });
  operation('/repositories/{repoName}', 'delete', 'Delete repository mapping', { role: 'owner' });
  operation('/guide', 'get', 'Read agent instructions', { public: true });
  operation('/openapi.json', 'get', 'Read this OpenAPI specification', { public: true });
  const schema = (properties: object, required?: string[]) => ({ type: 'object', additionalProperties: false, properties, ...(required ? { required } : { minProperties: 1 }) });
  const repoProperties = Object.fromEntries(['repoName', 'provider', 'url', 'defaultBranch', 'localPath', 'notes'].map((name) => [name, string]));
  const user = schema({ id: identifier, name: string }, ['id', 'name']);
  const schemas: Record<string, unknown> = {
    ItemCreate: schema(itemProperties, ['summary', 'description', 'category', 'type']), ItemUpdate: schema(itemProperties),
    ChildLink: schema({ childId: identifier }, ['childId']), CommentInput: schema({ text: { ...string, minLength: 1 } }, ['text']),
    ProjectUpdate: schema({ name: string, description: string, enabled: { type: 'boolean' }, status: string, visibility: { type: 'string', enum: ['public', 'private'] } }),
    RepositoryCreate: schema(repoProperties, ['repoName', 'url']), RepositoryUpdate: schema(repoProperties),
    User: user,
    Item: { type: 'object', properties: { ...itemProperties, id: identifier, projectId: identifier, assignee: { ...user, nullable: true }, category: string, createdAt: string, updatedAt: string } },
    Comment: { type: 'object', properties: { id: identifier, text: string, author: { ...user, nullable: true }, createdAt: string, updatedAt: string } },
    Repository: { type: 'object', properties: { ...repoProperties, project: string } },
    ProjectResult: { type: 'object', properties: { project: { type: 'object', properties: { id: identifier, name: string, description: string, enabled: { type: 'boolean' }, status: string, visibility: string } }, links: { type: 'object', additionalProperties: { type: 'string', format: 'uri' } } } },
    HierarchyNode: { type: 'object', properties: { item: ref('Item'), warning: string, children: { type: 'array', items: ref('HierarchyNode') } } },
    HierarchyResult: { type: 'object', properties: { roots: { type: 'array', items: ref('HierarchyNode') } } },
    Error: { type: 'object', properties: { error: { type: 'object', required: ['code', 'message'], properties: { code: string, message: string } } } },
  };
  for (const name of ['Item', 'Comment', 'Repository']) schemas[`${name}Result`] = { type: 'object', properties: { [name.toLowerCase()]: ref(name) } };
  for (const name of ['Item', 'Comment', 'Repository', 'User']) schemas[`${name}Page`] = { type: 'object', properties: { data: { type: 'array', items: ref(name) }, page: identifier, limit: { type: 'integer', minimum: 1, maximum: 100 }, total: { type: 'integer', minimum: 0 }, hasMore: { type: 'boolean' } } };
  return { openapi: '3.0.3', info: { title: 'Sirius Scientific DevOps Project Agent API', version: '1.0.0', description: 'Project-scoped API. No Git commits, builds, deployments, or device actions are performed. New and existing projects use these same dynamic routes.' }, servers: [{ url: base }], paths, components: { securitySchemes: { ProjectBearer: { type: 'http', scheme: 'bearer', description: 'Project credential issued by the local dashboard. Reader: reads. Editor: item/comment CRUD and assignments. Owner: additionally project metadata/deletion and repository mapping CRUD. Credentials cannot create other projects, manage users, or issue credentials.' } }, schemas } };
}

export function agentGuide(base: string) {
  const spec = projectOpenApi(base);
  const operations = Object.entries(spec.paths).flatMap(([path, methods]) => Object.entries(methods).map(([method, operation]) => `| ${method.toUpperCase()} | ${path} | ${(operation as { summary: string }).summary} |`));
  return `# Sirius Scientific DevOps: Project Agent Guide

Base URL: ${base}
OpenAPI: ${base}/openapi.json

## Authentication and trust
Read this guide and OpenAPI first. Request a credential from the human operator using this project's API Access control. Send Authorization: Bearer <PROJECT_TOKEN> on every data request. Never place credentials in URLs, Git, notes, logs, or chat transcripts. Documentation is public but contains no live project data or keys.
Reader permits reads; editor also permits item/comment CRUD and assignment; owner additionally permits project metadata/deletion and repository mapping CRUD. All roles are confined to this project. Credentials expire, can be revoked, and are shown only once when issued. Rotation means issue a replacement, transfer it securely, then revoke the old key. Agent credentials cannot manage access or create other projects. Project creation is an operator dashboard action; its API and documentation are available immediately.
This installation is a trusted local dashboard, not a public multi-tenant service. Keep it bound to loopback. Legacy dashboard APIs and local credential-management controls are operator surfaces, not remotely secured agent APIs. Do not expose the whole application to untrusted networks without separate operator authentication and HTTPS.

## Rich text
Long-form descriptions, comments, progress updates, logs and repository notes use GitHub-flavored Markdown. Preserve headings, emphasis, lists, tables, fenced code language tags and image links when editing. Do not send editor JSON or raw HTML. Commit message drafts remain plain text. Local editor uploads produce immutable random image URLs; preserve those URLs exactly. Images are stored inside this installation, not in Git or as embedded base64. Image reads use random capability URLs on this trusted-local host; they are not a public multi-tenant asset service. Agent credentials cannot upload through the local-operator editor upload route. Do not rewrite image links or attempt other projects' asset paths.

## Workflow
1. GET / to confirm the project; GET /metadata for configured statuses, actual categories and supported types; GET /users for eligible assignee IDs.
2. GET /hierarchy and search /items before creating work. Do not invent progress, test results, or completion evidence.
3. Use Epic > User Story > Feature > Task > Bug. Epic alone has parentId null. Every other item needs a parent of the preceding type in this same project. Improvement and Technical Debt require Feature parents. A child has exactly one parent. Self-links, cycles, skipped levels, incomplete ancestry, and cross-project links are rejected.
4. Create parent levels first. POST /items requires summary, non-empty description, category and type. Use exact type "User Story" for stories. Description cannot be blanked through this API. Unsupported fields are rejected; do not send native Mantis fields or a project override.
5. PATCH /items/{itemId} with assigneeId from /users to assign a person; assigneeId null unassigns. parentId changes the parent. POST /items/{itemId}/children with childId moves that existing child here; it does not copy the child or create multiple parents. Create a new child using POST /items with parentId. Move/delete children before deleting their parent.
6. Comments support create/read/edit/delete. New comments are private; edits preserve their Mantis identity and history. GET the item again after saving to confirm its state. Only the owning project can address its items, comments or mappings.
7. Repository endpoints manage mappings only; they never access the filesystem repository, push, commit, build, or deploy. Remove mappings before renaming the project, and remove all items/mappings before deleting it. API project deletion is intentionally non-cascading.

## Examples (replace placeholders; never paste a real credential into tracked scripts)

\x60\x60\x60sh
curl -H "Authorization: Bearer $PROJECT_TOKEN" "${base}/items?type=Task&page=1&limit=50"
curl -X POST -H "Authorization: Bearer $PROJECT_TOKEN" -H "Content-Type: application/json" "${base}/items" -d '{"summary":"Example task","description":"Describe the requested work","category":"<category from metadata>","type":"Task","parentId":<feature ID>}'
curl -X PATCH -H "Authorization: Bearer $PROJECT_TOKEN" -H "Content-Type: application/json" "${base}/items/<item ID>" -d '{"assigneeId":<eligible user ID>}'
\x60\x60\x60

## Pagination, errors and retries
Collection responses contain data, page, limit, total and hasMore. Page starts at 1; limit defaults to 50 and cannot exceed 100. Iterate until hasMore is false. /items supports type, status, q (case-insensitive ID/title/description search), parentId and assigneeId. For the last two use the literal query value null to select roots/unassigned. /hierarchy returns the complete tree, including warnings for malformed legacy records.
Errors use {"error":{"code":"...","message":"..."}}. 400 means invalid input/hierarchy; 401 missing/expired/revoked/wrong-project key; 403 insufficient role; 404 not found in this project; 409 children, linked mappings, or duplicates; 405 unsupported operation; 502 backend/storage failure. There are no automatic write retries or idempotency keys: after an interrupted write or 502, read/search current state before retrying, especially creates and comments.
Available writable item fields: summary, description, category, type, status, parentId, assigneeId, sprint, storyPoints, deviceInfo, appVersion, osVersion, logs, verification, releaseReadiness. Empty optional custom-field strings clear their values on PATCH. Omitted fields stay unchanged. Mantis validates configured statuses/custom-field option values; rejected updates retain a 400 or 409 status with sanitized errors, while backend/storage failures return 502. Neither is success.

## Endpoint Reference
| Method | Relative endpoint | Purpose |
| --- | --- | --- |
${operations.join('\n')}
`;
}
