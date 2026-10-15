const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports, URL, URLSearchParams, Request, Response, Headers, Buffer, process, Error, SyntaxError, Number, Date, require(name) {
    if (name in imports) return imports[name];
    if (name.startsWith('node:')) return require(name);
    throw new Error(`Unexpected import: ${name}`);
  } });
  return exports;
}
const h = load('app/hierarchy.ts');
const payload = load('app/api/issues/payload.ts');
const docs = load('app/api/agent-docs.ts');
const access = load('app/api/agent-access.ts');
const plain = (value) => JSON.parse(JSON.stringify(value));

test('project credentials are hashed, persistent, project scoped and revocable', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'sirius-agent-test-'));
  try {
    const file = path.join(directory, 'keys.json');
    const store = access.createAccessStore(file);
    const issued = await store.issue(7, 'Synthetic agent', 'editor', 1);
    assert.match(issued.token, /^ssdo_[a-f0-9]{64}$/);
    assert.ok(!(await fsp.readFile(file, 'utf8')).includes(issued.token));
    assert.ok(!JSON.stringify(await store.list(7)).includes('hash'));
    assert.equal((await access.createAccessStore(file).authenticate(7, issued.token)).role, 'editor');
    assert.equal(await store.authenticate(8, issued.token), null);
    assert.equal(await store.authenticate(7, `${issued.token.slice(0, -1)}x`), null);
    assert.equal(await store.revoke(8, issued.key.id), false);
    assert.equal(await store.revoke(7, issued.key.id), true);
    assert.equal(await store.authenticate(7, issued.token), null);
    const expiring = await store.issue(7, 'Expired synthetic agent', 'reader', 1);
    const keys = JSON.parse(await fsp.readFile(file, 'utf8'));
    keys.find((key) => key.id === expiring.key.id).expiresAt = '2000-01-01T00:00:00.000Z';
    await fsp.writeFile(file, JSON.stringify(keys));
    assert.equal(await store.authenticate(7, expiring.token), null);
    await assert.rejects(store.issue(7, '', 'editor', 1), /Invalid/);
    await assert.rejects(store.issue(7, 'Test', 'admin', 1), /Invalid/);
    await assert.rejects(store.issue(7, 'Test', 'reader', 366), /Invalid/);
  } finally { await fsp.rm(directory, { recursive: true, force: true }); }
});

test('credential management requires the trusted local operator surface, not an agent credential', () => {
  const local = new Request('http://127.0.0.1:8878/api/projects/7/access', { method: 'POST', headers: { origin: 'http://127.0.0.1:8878', 'sec-fetch-site': 'same-origin' } });
  assert.equal(access.localOperatorRequest(local), true);
  for (const request of [
    new Request(local.url, { method: 'POST' }),
    new Request(local.url, { method: 'POST', headers: { origin: 'https://other.test', 'sec-fetch-site': 'same-origin' } }),
    new Request(local.url, { method: 'POST', headers: { ...Object.fromEntries(local.headers), authorization: 'Bearer synthetic' } }),
    new Request('https://remote.test/api/projects/7/access', { method: 'POST', headers: { origin: 'https://remote.test', 'sec-fetch-site': 'same-origin' } }),
  ]) assert.equal(access.localOperatorRequest(request), false);
});

test('local credential management uses the browser Host without trusting forwarded origins', () => {
  for (const host of ['127.0.0.1:8878', 'localhost:8878', '[::1]:8878']) {
    const request = new Request('http://localhost:8878/api/projects/12/access', {
      method: 'POST', headers: { host, origin: `http://${host}`, 'sec-fetch-site': 'same-origin' },
    });
    assert.equal(access.localOperatorRequest(request), true, host);
  }
  const valid = { host: '127.0.0.1:8878', origin: 'http://127.0.0.1:8878', 'sec-fetch-site': 'same-origin' };
  for (const changes of [
    { host: 'remote.test:8878', origin: 'http://remote.test:8878' },
    { host: '127.0.0.1:8879', origin: 'http://127.0.0.1:8879' },
    { origin: 'http://localhost:8878' },
    { origin: 'null' },
    { origin: 'https://127.0.0.1:8878' },
    { host: 'user@127.0.0.1:8878' },
    { host: '127.0.0.1:8878/path' },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
    { authorization: '' },
    { authorization: 'Bearer synthetic' },
    { host: 'remote.test:8878', 'x-forwarded-host': '127.0.0.1:8878' },
  ]) {
    const request = new Request('http://localhost:8878/api/projects/12/access', { method: 'POST', headers: { ...valid, ...changes } });
    assert.equal(access.localOperatorRequest(request), false, JSON.stringify(changes));
  }
  assert.equal(access.localOperatorRequest(new Request('http://localhost:8878/api/projects/12/access', {
    headers: { host: 'remote.test:8878', 'sec-fetch-site': 'same-origin' },
  })), false);
});

function item(id, type, parentId = '', projectId = 1) {
  return { id, summary: `Synthetic ${type} ${id}`, description: 'Synthetic test record', project: { id: projectId, name: `Project ${projectId}` }, status: { name: 'new' }, category: { name: 'General' }, notes: [],
    custom_fields: [{ field: { name: 'Work Item Type' }, value: type }, { field: { name: 'Parent Issue' }, value: String(parentId) }] };
}
function harness(options = {}) {
  const records = [item(1, 'Epic'), item(2, 'User Story', 1), item(3, 'Feature', 2), item(4, 'Task', 3), item(5, 'Bug', 4), item(6, 'Task', 3), item(20, 'Epic', '', 2), item(21, 'User Story', 20, 2)];
  records[3].notes = [{ id: 9, text: 'Synthetic progress', reporter: { id: 7, name: 'Person', email: 'must-not-leak@test.invalid' } }];
  records[3].relationships = [{ issue: { id: 20, summary: 'Foreign detail must not leak' } }];
  const projects = [{ id: 1, name: 'Project 1', categories: [{ id: 1, name: 'General' }] }, { id: 2, name: 'Project 2' }];
  let repositories = options.emptyRepos ? [] : [{ project: 'Project 1', repoName: 'one', url: 'https://example.test/one', provider: 'github', defaultBranch: 'main', localPath: '', notes: '' }, { project: 'Project 2', repoName: 'two', url: 'https://example.test/two' }];
  const writes = [], bridges = [];
  const mantis = { async mantisFetch(url, init) {
    if (options.upstreamStatus) throw Object.assign(new Error('Mantis private upstream details'), { status: options.upstreamStatus });
    if (options.fail) throw new Error('Mantis request failed: secret-must-not-leak');
    if (init) {
      const input = init.body ? JSON.parse(init.body) : undefined;
      writes.push({ url, method: init.method, input });
      const match = url.match(/^\/api\/rest\/issues\/(\d+)$/);
      if (match && init.method === 'PATCH') {
        const record = records.find((entry) => entry.id === Number(match[1]));
        for (const key of ['summary', 'description', 'handler', 'status', 'category']) if (input[key] !== undefined) record[key] = input[key];
        for (const field of input.custom_fields ?? []) {
          record.custom_fields = record.custom_fields.filter((entry) => entry.field.name !== field.field.name);
          record.custom_fields.push(field);
        }
      }
      if (match && init.method === 'DELETE') records.splice(records.findIndex((entry) => entry.id === Number(match[1])), 1);
      if (url === '/api/rest/issues' && init.method === 'POST') {
        const created = { ...input, id: 30, project: { id: 1, name: 'Project 1' }, notes: [] }; records.push(created); return { issue: { id: created.id } };
      }
      if (url.endsWith('/notes') && init.method === 'POST') return { note: { id: 10 } };
      return {};
    }
    if (url === '/api/rest/projects') return { projects };
    if (url.startsWith('/api/rest/config?option=status_enum_string&project_id=1')) return { configs: [{ option: 'status_enum_string', value: [{ id: 10, name: 'new', label: 'New' }, { id: 80, name: 'testing', label: 'Testing' }] }] };
    if (/\/projects\/\d+\/handlers/.test(url)) return { users: [{ id: 7, name: 'Person', email: 'must-not-leak@test.invalid' }] };
    if (/\/projects\/\d+$/.test(url)) return { projects: projects.filter((entry) => entry.id === Number(url.split('/').at(-1))) };
    if (url.startsWith('/api/rest/issues?')) {
      const projectId = new URLSearchParams(url.split('?')[1]).get('project_id');
      return { issues: records.filter((entry) => !projectId || String(entry.project.id) === projectId) };
    }
    if (/\/issues\/\d+$/.test(url)) return { issues: records.filter((entry) => entry.id === Number(url.split('/').at(-1))) };
    throw new Error(`Unexpected upstream path: ${url}`);
  } };
  const users = load('app/api/project-users.ts', { './mantis': mantis });
  const hierarchy = load('app/api/issues/hierarchy.ts', { '../mantis': mantis, '../../hierarchy': h });
  const repos = load('app/api/repos/store.ts');
  const bridge = { projectBridge: async (input) => { bridges.push(input); } };
  const updates = load('app/api/issues/update.ts', { '../mantis': mantis, '../project-bridge': bridge, '../../hierarchy': h });
  const service = load('app/api/agent-project.ts', {
    './agent-access': { agentAccess: { authenticate: async (projectId, token) => projectId === 1 && ['reader', 'editor', 'owner'].includes(token) ? { role: token } : null } },
    './mantis': mantis, './issues/hierarchy': hierarchy, './issues/payload': payload,
    './issues/update': updates,
    './project-users': users, './project-bridge': bridge,
    './repos/store': { normalizeRepo: repos.normalizeRepo, readRegistry: async () => ({ repositories: plain(repositories) }), writeRegistry: async (registry) => { repositories = registry.repositories; writes.push({ registry }); } },
    '../hierarchy': h, './agent-docs': docs,
  });
  async function request(method, resource = '', body, role = 'editor', projectId = '1', query = '') {
    return service.projectAgentRequest(new Request(`http://127.0.0.1:8878/api/v1/projects/${projectId}/${resource}${query}`, { method, headers: { authorization: `Bearer ${role}`, 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), projectId, resource ? resource.split('/') : []);
  }
  return { request, records, writes, bridges, users };
}

test('schema and guide are public, generated per project and contain every supported operation', async () => {
  const api = harness();
  for (const project of ['1', '123']) {
    const response = await api.request('GET', 'openapi.json', undefined, '', project);
    assert.equal(response.status, 200);
    const spec = await response.json();
    assert.equal(spec.servers[0].url, `http://127.0.0.1:8878/api/v1/projects/${project}`);
    assert.equal(spec.openapi, '3.0.3');
    const guide = await (await api.request('GET', 'guide', undefined, '', project)).text();
    for (const [path, methods] of Object.entries(spec.paths)) for (const method of Object.keys(methods)) assert.ok(guide.includes(`| ${method.toUpperCase()} | ${path} |`));
    assert.ok(guide.includes('loopback'));
    assert.ok(!guide.includes('ssdo_'));
    assert.ok(!guide.includes('Synthetic progress'));
  }
  assert.equal(api.writes.length, 0);
});

test('missing and wrong-project credentials fail before project data access or writes', async () => {
  const api = harness();
  for (const [project, token] of [['1', ''], ['1', 'invalid'], ['2', 'owner']]) assert.equal((await api.request('GET', '', undefined, token, project)).status, 401);
  assert.equal((await api.request('GET', '', undefined, 'owner', '../2')).status, 400);
  assert.equal(api.writes.length, 0);
});

test('reader can read but cannot mutate; editor cannot administer projects or repositories', async () => {
  const api = harness();
  assert.equal((await api.request('GET', '', undefined, 'reader')).status, 200);
  assert.equal((await api.request('PATCH', 'items/4', { summary: 'Changed' }, 'reader')).status, 403);
  assert.equal((await api.request('PATCH', '', { description: 'Changed' }, 'editor')).status, 403);
  assert.equal((await api.request('POST', 'repositories', { repoName: 'new', url: 'https://example.test' }, 'editor')).status, 403);
  assert.equal(api.writes.length, 0);
});

test('items, comments, parent and child links cannot escape project scope', async () => {
  const api = harness();
  for (const [method, path, body] of [
    ['GET', 'items/20'], ['PATCH', 'items/20', { summary: 'No' }], ['DELETE', 'items/20'],
    ['GET', 'items/20/comments'], ['PATCH', 'items/4', { parentId: 20 }],
    ['POST', 'items/1/children', { childId: 21 }],
    ['POST', 'items', { summary: 'No', description: 'No', category: 'General', type: 'User Story', parentId: 20 }],
  ]) assert.equal((await api.request(method, path, body)).status, 404, `${method} ${path}`);
  assert.equal((await api.request('PATCH', 'items/4', { project: 'Project 2' })).status, 400);
  assert.equal((await api.request('PATCH', 'items/4/comments/99', { text: 'No' })).status, 404);
  assert.equal(api.writes.length, 0);
  assert.equal(api.bridges.length, 0);
});

test('item reads are normalized and do not expose foreign relationships or private user fields', async () => {
  const api = harness();
  const serialized = await (await api.request('GET', 'items/4')).text();
  assert.ok(!serialized.includes('Foreign detail'));
  assert.ok(!serialized.includes('relationships'));
  const people = await (await api.request('GET', 'users')).json();
  assert.deepEqual(people.data, [{ id: 7, name: 'Person' }]);
  assert.ok(!(await (await api.request('GET', 'items/4/comments')).text()).includes('must-not-leak'));
});

test('search, exact type, assignment, parent filters and pagination return scoped records', async () => {
  const api = harness();
  api.records[3].handler = { id: 7, name: 'Person' };
  const tasks = await (await api.request('GET', 'items', undefined, 'reader', '1', '?type=Task&parentId=3&limit=1&page=2')).json();
  assert.equal(tasks.total, 2); assert.equal(tasks.data.length, 1); assert.equal(tasks.page, 2); assert.equal(tasks.hasMore, false);
  const assigned = await (await api.request('GET', 'items', undefined, 'reader', '1', '?assigneeId=7&q=TASK')).json();
  assert.deepEqual(assigned.data.map((entry) => entry.id), [4]);
  const roots = await (await api.request('GET', 'items', undefined, 'reader', '1', '?parentId=null')).json();
  assert.deepEqual(roots.data.map((entry) => entry.id), [1]);
  for (const query of ['?limit=101', '?page=0', '?type=Story', '?parentId=0', '?unknown=x']) assert.equal((await api.request('GET', 'items', undefined, 'reader', '1', query)).status, 400);
});

test('metadata discovers actual configured categories, statuses and eligible types', async () => {
  const response = await harness().request('GET', 'metadata');
  assert.equal(response.status, 200);
  const metadata = await response.json();
  assert.deepEqual(metadata.statuses.map((entry) => entry.name), ['new', 'testing']);
  assert.deepEqual(metadata.categories, [{ id: 1, name: 'General' }]);
  assert.ok(metadata.types.includes('User Story'));
});

test('eligible assignees assign and unassign using native Mantis handler fields', async () => {
  const api = harness();
  assert.equal((await api.request('PATCH', 'items/4', { assigneeId: 7 })).status, 200);
  assert.deepEqual(api.writes[0].input.handler, { id: 7 });
  assert.equal((await api.request('PATCH', 'items/4', { assigneeId: null })).status, 200);
  assert.deepEqual(api.writes[1].input.handler, { id: 0 });
  assert.equal((await api.request('PATCH', 'items/4', { assigneeId: 999 })).status, 400);
  assert.equal(api.writes.length, 2);
  assert.deepEqual(plain(payload.issuePayload({ assigneeId: '' }, true).handler), { id: 0 });
  await assert.rejects(api.users.validateAssignee(1, 'invalid'), /eligible/);
});

test('project API assignment preserves an existing title-only epic and still rejects ineligible users', async () => {
  const api = harness();
  api.records[0].description = '';
  assert.equal((await api.request('PATCH', 'items/1', { assigneeId: 7 })).status, 200);
  assert.equal(api.bridges.length, 1);
  assert.equal(api.bridges[0].operation, 'planning-update');
  assert.equal(api.bridges[0].payload.handler.id, 7);
  assert.equal(api.records[0].description, '');
  assert.equal(api.writes.length, 0);
  assert.equal((await api.request('PATCH', 'items/1', { assigneeId: 999 })).status, 400);
  assert.equal(api.bridges.length, 1);
});

test('hierarchy prevents cycles, missing levels, illegal roots and deletion with children', async () => {
  const api = harness();
  for (const input of [{ parentId: 4 }, { parentId: 1 }, { parentId: null }, { type: 'Feature' }]) assert.equal((await api.request('PATCH', 'items/4', input)).status, 400);
  assert.equal((await api.request('DELETE', 'items/1')).status, 409);
  assert.equal(api.writes.length, 0);
  assert.equal((await api.request('POST', 'items/6/children', { childId: 5 })).status, 200);
  assert.equal(h.parentId(api.records.find((entry) => entry.id === 5)), 6);
  const tree = await (await api.request('GET', 'hierarchy')).json();
  assert.equal(tree.roots[0].item.id, 1);
  assert.ok(!JSON.stringify(tree).includes('Project 2'));
  const children = await (await api.request('GET', 'items/6/children')).json();
  assert.equal(children.data[0].id, 5);
});

test('create provisions fields, preserves explicit type/parent and never invents progress', async () => {
  const api = harness();
  const response = await api.request('POST', 'items', { summary: 'Synthetic new task', description: 'Requested work', category: 'General', type: 'Task', parentId: 3, assigneeId: 7 });
  assert.equal(response.status, 201);
  const created = (await response.json()).item;
  assert.equal(created.id, 30); assert.equal(created.type, 'Task'); assert.equal(created.parentId, 3);
  assert.equal(created.projectId, 1); assert.equal(created.verification, '');
  assert.deepEqual(plain(api.bridges), [{ operation: 'configure', projectId: 1 }]);
  assert.equal((await api.request('POST', 'items', { summary: 'Bad', description: 'D', category: 'General', type: 'Bug' })).status, 400);
  assert.equal((await api.request('POST', 'items', { summary: 'Bad', description: '', category: 'General', type: 'Epic' })).status, 400);
  assert.equal((await api.request('PATCH', 'items/30', { description: '' })).status, 400);
  assert.equal((await api.request('PATCH', 'items/30', {})).status, 400);
});

test('optional custom fields clear explicitly without erasing unrelated metadata', async () => {
  const api = harness();
  assert.equal((await api.request('PATCH', 'items/4', { sprint: '', logs: '' })).status, 200);
  assert.deepEqual(api.writes[0].input.custom_fields, [{ field: { name: 'Sprint' }, value: '' }, { field: { name: 'Relevant Logs' }, value: '' }]);
  assert.equal(h.workType(api.records[3]), 'Task');
  assert.equal(payload.issuePayload({ sprint: '', logs: '' }, true).custom_fields, undefined);
});

test('comment create/read/edit/delete preserves scope, private visibility and identity', async () => {
  const api = harness();
  assert.equal((await api.request('GET', 'items/4/comments/9')).status, 200);
  assert.equal((await api.request('POST', 'items/4/comments', { text: 'Synthetic new comment' })).status, 201);
  assert.equal(api.writes[0].input.view_state.name, 'private');
  assert.equal((await api.request('PATCH', 'items/4/comments/9', { text: 'Revised' })).status, 200);
  assert.deepEqual(plain(api.bridges[0]), { operation: 'note-update', projectId: 1, itemId: 4, noteId: 9, text: 'Revised' });
  assert.equal((await api.request('DELETE', 'items/4/comments/9')).status, 200);
  assert.equal(api.writes[1].url, '/api/rest/issues/4/notes/9');
  assert.equal((await api.request('POST', 'items/4/comments', { text: '' })).status, 400);
});

test('repository CRUD uses only the owning project and rejects project overrides', async () => {
  const api = harness();
  assert.equal((await api.request('GET', 'repositories/two', undefined, 'owner')).status, 404);
  assert.equal((await api.request('POST', 'repositories', { project: 'Project 2', repoName: 'No', url: 'https://example.test' }, 'owner')).status, 400);
  assert.equal((await api.request('POST', 'repositories', { repoName: 'new', url: 'https://example.test/new' }, 'owner')).status, 201);
  assert.equal((await api.request('PATCH', 'repositories/new', { defaultBranch: 'develop' }, 'owner')).status, 200);
  assert.equal((await (await api.request('GET', 'repositories/new')).json()).repository.defaultBranch, 'develop');
  assert.equal((await api.request('POST', 'repositories', { repoName: 'new', url: 'https://example.test/new' }, 'owner')).status, 409);
  assert.equal((await api.request('DELETE', 'repositories/new', undefined, 'owner')).status, 200);
});

test('owner project updates/deletion are guarded and backend failures are sanitized', async () => {
  const api = harness();
  assert.equal((await api.request('PATCH', '', { description: 'New description' }, 'owner')).status, 200);
  assert.equal((await api.request('PATCH', '', { name: 'Renamed' }, 'owner')).status, 409);
  assert.equal((await api.request('DELETE', '', undefined, 'owner')).status, 409);
  const empty = harness({ emptyRepos: true }); empty.records.splice(0);
  assert.equal((await empty.request('DELETE', '', undefined, 'owner')).status, 200);
  const failing = harness({ fail: true });
  const response = await failing.request('GET');
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('secret-must-not-leak'));
});

test('native upstream not-found and validation statuses survive without exposing response bodies', async () => {
  for (const status of [404, 400, 409]) {
    const response = await harness({ upstreamStatus: status }).request('GET');
    assert.equal(response.status, status);
    assert.ok(!(await response.text()).includes('private upstream details'));
  }
  assert.equal((await harness().request('PATCH', 'items/4', { assigneeId: [7] })).status, 400);
});

test('card links and child controls render without credentials or hardcoded project IDs', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const imports = { react: React, 'react/jsx-runtime': require('react/jsx-runtime') };
  const { ProjectApiLinks } = load('app/project-api-links.tsx', imports);
  const html = renderToStaticMarkup(React.createElement(ProjectApiLinks, { projectId: 123 }));
  assert.ok(html.includes('/api/v1/projects/123'));
  assert.ok(html.includes('/api/v1/projects/123/openapi.json'));
  assert.ok(html.includes('Copy Agent Instructions'));
  assert.ok(!html.includes('ssdo_'));
  const { ChildAssignments, eligibleChildren } = load('app/child-assignments.tsx', { ...imports, './hierarchy': h });
  const records = [item(1, 'Epic'), item(2, 'User Story', 1), item(3, 'Feature', 2), item(4, 'Task', 3), item(6, 'Task', 3), item(5, 'Bug', 4), item(20, 'Epic', '', 2)];
  assert.deepEqual(Array.from(eligibleChildren(records[4], records), (entry) => entry.id), [5]);
  const controls = renderToStaticMarkup(React.createElement(ChildAssignments, { item: records[4], items: records, onChange() {}, onOpen() {}, onCreate() {} }));
  assert.ok(controls.includes('Link Child'));
  assert.ok(controls.includes('New Bug'));
  assert.ok(controls.includes('move from #4'));
});
