const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const snapshotPath = path.join(root, 'backups', 'workitem-reorganization-before.json');
async function main() {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'mantis.config.json'), 'utf8').replace(/^\uFEFF/, ''));
  async function get(endpoint) {
    const response = await fetch(config.baseUrl.replace(/\/$/, '') + '/api/rest' + endpoint, { headers: { Authorization: config.apiToken } });
    if (!response.ok) throw new Error(`Mantis read failed (${response.status}) at ${endpoint}`);
    return response.json();
  }
  if (process.argv[2] === 'snapshot') {
    if (fs.existsSync(snapshotPath)) throw new Error('Snapshot already exists; refusing to overwrite.');
    const projects = (await get('/projects')).projects;
    const userResponse = await get('/users/me');
    const me = userResponse.users?.[0] ?? userResponse.user ?? userResponse;
    if (!me.id || !me.name) throw new Error('Cannot identify the Mantis API user.');
    const issues = [];
    for (let page = 1; ; page++) {
      const batch = (await get(`/issues?page_size=100&page=${page}`)).issues;
      for (const entry of batch) issues.push((await get(`/issues/${entry.id}`)).issues[0]);
      if (batch.length < 100) break;
    }
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, JSON.stringify({ createdAt: new Date().toISOString(), actor: { id: me.id, name: me.name }, projects, issues }, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ snapshotPath, issues: issues.length, projects: projects.length }));
  } else if (process.argv[2] === 'plan') {
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    const plan = require('./workitem-reorganization-plan.cjs').buildPlan(snapshot);
    const planPath = path.join(root, 'backups', 'workitem-reorganization-plan.json');
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ original: snapshot.issues.length, created: plan.nodes.filter((node) => !node.id).length, total: plan.nodes.length, counts: plan.nodes.reduce((counts, node) => { counts[node.type] = (counts[node.type] ?? 0) + 1; return counts; }, {}) }));
  } else if (process.argv[2] === 'verify') {
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    const result = JSON.parse(fs.readFileSync(path.join(root, 'backups', 'workitem-reorganization-result.json'), 'utf8'));
    const plan = JSON.parse(fs.readFileSync(path.join(root, 'backups', 'workitem-reorganization-plan.json'), 'utf8'));
    const all = [];
    for (let page = 1; ; page++) {
      const batch = (await get(`/issues?page_size=100&page=${page}`)).issues;
      all.push(...batch);
      if (batch.length < 100) break;
    }
    if (all.length !== result.total) throw new Error('Unexpected work-item count after reorganization.');
    const ts = require(path.join(root, 'dashboard', 'node_modules', 'typescript'));
    const exports = {};
    require('node:vm').runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'dashboard', 'app', 'hierarchy.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports });
    const problems = exports.hierarchyProblems(all);
    if (problems.size) throw new Error(`Invalid live hierarchy: ${[...problems.keys()].join(', ')}`);
    for (const original of snapshot.issues) {
      const live = (await get(`/issues/${original.id}`)).issues[0];
      for (const key of ['summary', 'description', 'steps_to_reproduce', 'additional_information', 'project', 'status', 'resolution', 'priority', 'severity', 'category', 'handler', 'notes', 'attachments']) {
        if (JSON.stringify(live[key]) !== JSON.stringify(original[key])) throw new Error(`Original #${original.id} changed unexpectedly: ${key}`);
      }
      for (const field of original.custom_fields ?? []) {
        if (['Work Item Type', 'Parent Issue'].includes(field.field.name)) continue;
        const actual = live.custom_fields?.find((entry) => entry.field.name === field.field.name);
        if (JSON.stringify(actual?.value) !== JSON.stringify(field.value)) throw new Error(`Original #${original.id} lost a custom-field value.`);
      }
    }
    for (const node of plan.nodes) {
      const live = all.find((item) => item.id === result.ids[node.key]);
      if (!live || exports.workType(live) !== node.type || exports.parentId(live) !== (node.parent === null ? null : result.ids[node.parent])) throw new Error(`Live plan mismatch: ${node.key}`);
      if (!node.id && live.description !== '') throw new Error(`Expected blank description: ${node.key}`);
    }
    const report = { verifiedAt: new Date().toISOString(), total: all.length, originalRecordsPreserved: snapshot.issues.length, titleOnlyRecordsCreated: result.created.length, hierarchyProblems: problems.size, counts: all.reduce((counts, item) => { const type = exports.workType(item); counts[type] = (counts[type] ?? 0) + 1; return counts; }, {}) };
    fs.writeFileSync(path.join(root, 'backups', 'workitem-reorganization-verification.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } else if (process.argv[2] === 'read') {
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    const filter = process.argv[3];
    const ids = process.argv[4]?.split(',').map(Number);
    for (const item of snapshot.issues.filter((item) => (!filter || String(item.project.id) === filter) && (!ids || ids.includes(item.id)))) {
      console.log(JSON.stringify({ id: item.id, project: item.project, summary: item.summary, description: item.description, steps: item.steps_to_reproduce, additional: item.additional_information, notes: item.notes?.map((note) => ({ text: note.text })), type: item.custom_fields?.find((entry) => entry.field.name === 'Work Item Type')?.value, parent: item.custom_fields?.find((entry) => entry.field.name === 'Parent Issue')?.value }, null, 2));
    }
  } else throw new Error('Use snapshot or read [projectId].');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
