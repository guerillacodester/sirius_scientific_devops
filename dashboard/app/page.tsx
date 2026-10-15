'use client';

import { useEffect, useMemo, useState } from 'react';
import { draftCommitMessage } from './task-update';
import { tabFromHash, workTabForType, workspaceTabs, type WorkspaceTab } from './navigation';
import { WorkBoard } from './work-items';
import { hierarchyProblems, validateParent, workType, type WorkItem } from './hierarchy';
import { HierarchyExplorer } from './hierarchy-explorer';
import { ProjectApiLinks } from './project-api-links';
import { ChildAssignments } from './child-assignments';
import { CardDetailsProvider, CardViewButton } from './card-details';
import { RichEditor } from './rich-editor';
import { RichContent } from './rich-content';

type Issue = {
  id: number;
  summary: string;
  description?: string;
  project?: { id: number; name: string };
  category?: { name: string };
  handler?: { id?: number; name: string };
  priority?: { name: string; label?: string };
  severity?: { name: string; label?: string };
  status?: { name: string; label?: string };
  updated_at?: string;
  custom_fields?: Array<{ field?: { name?: string }; value?: string }>;
};

type Project = {
  id: number;
  name: string;
  description?: string;
  enabled?: boolean;
  status?: { name?: string; label?: string };
  view_state?: { name?: string; label?: string };
  categories?: Array<{ id: number; name: string }>;
};

type RepoEntry = {
  project: string;
  repoName: string;
  provider: string;
  url: string;
  defaultBranch: string;
  localPath?: string;
  notes?: string;
};

type ProjectDraft = { id?: number; name: string; description: string; status: string; view_state: string; enabled: boolean };
type IssueDraft = {
  id?: number;
  project: string;
  category: string;
  summary: string;
  description: string;
  status: string;
  type: string;
  sprint: string;
  storyPoints: string;
  parentId: string;
  assigneeId: string;
  deviceInfo: string;
  appVersion: string;
  osVersion: string;
  logs: string;
  verification: string;
  releaseReadiness: string;
};

const emptyRepo: RepoEntry = { project: '', repoName: '', provider: 'github', url: '', defaultBranch: 'main', localPath: '', notes: '' };
const emptyProject: ProjectDraft = { name: '', description: '', status: 'development', view_state: 'public', enabled: true };
const emptyIssue: IssueDraft = {
  project: '',
  category: '',
  summary: '',
  description: '',
  status: '',
  type: 'Bug',
  sprint: '',
  storyPoints: '',
  parentId: '',
  assigneeId: '',
  deviceInfo: '',
  appVersion: '',
  osVersion: '',
  logs: '',
  verification: 'Unverified',
  releaseReadiness: 'Not Assessed',
};

const columns = ['new', 'assigned', 'in_progress', 'code_review', 'testing', 'resolved', 'closed'];
const readinessValues = ['Ready', 'At Risk', 'Blocked', 'Not Assessed'];
const workTypes = ['Epic', 'Feature', 'User Story', 'Task', 'Bug', 'Improvement', 'Technical Debt'];

function field(issue: Issue, name: string) {
  return issue.custom_fields?.find((item) => item.field?.name === name)?.value ?? '';
}

function label(value?: string) {
  return (value || 'Unspecified').replace(/_/g, ' ');
}

function reportCounts(issues: Issue[], valueFor: (issue: Issue) => string) {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    const value = valueFor(issue) || 'Unspecified';
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

export default function DashboardPage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [projectId, setProjectId] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sprintFilter, setSprintFilter] = useState('');
  const [query, setQuery] = useState('');
  const [repoDraft, setRepoDraft] = useState<RepoEntry>(emptyRepo);
  const [editingRepo, setEditingRepo] = useState<{ project: string; repoName: string } | null>(null);
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>(emptyProject);
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [issueDraft, setIssueDraft] = useState<IssueDraft>(emptyIssue);
  const [editingIssueId, setEditingIssueId] = useState<number | null>(null);
  const [updateRepoName, setUpdateRepoName] = useState('');
  const [updateText, setUpdateText] = useState('');
  const [commitOverride, setCommitOverride] = useState<string | null>(null);
  const [savingUpdate, setSavingUpdate] = useState(false);
  const [busyEditors, setBusyEditors] = useState<Set<string>>(new Set());
  function editorBusy(name: string, busy: boolean) {
    setBusyEditors((current) => { const next = new Set(current); busy ? next.add(name) : next.delete(name); return next; });
  }
  const [updateSaved, setUpdateSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [theme, setTheme] = useState('dark');
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [drillProjectId, setDrillProjectId] = useState('');
  const [drillItemId, setDrillItemId] = useState<number | null>(null);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showRepoForm, setShowRepoForm] = useState(false);
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [assignees, setAssignees] = useState<Array<{ id: number; name: string }>>([]);
  const [assigneeState, setAssigneeState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [open, setOpen] = useState({ projects: true, issues: true, reports: true, repos: true, board: true });
  const [menu, setMenu] = useState<string | null>(null);

  useEffect(() => {
    const syncTab = () => {
      setActiveTab(tabFromHash(window.location.hash)); setTypeFilter(''); setMenu(null);
      const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
      setDrillProjectId(params.get('project') ?? '');
      const itemId = Number(params.get('item'));
      setDrillItemId(Number.isSafeInteger(itemId) && itemId > 0 ? itemId : null);
    };
    syncTab();
    window.addEventListener('hashchange', syncTab);
    window.addEventListener('popstate', syncTab);
    return () => {
      window.removeEventListener('hashchange', syncTab);
      window.removeEventListener('popstate', syncTab);
    };
  }, []);

  function navigateTo(tab: WorkspaceTab) {
    setActiveTab(tab);
    setTypeFilter('');
    setMenu(null);
    if (tab === 'hierarchy') { setDrillProjectId(''); setDrillItemId(null); }
    if (window.location.hash !== `#${tab}`) window.history.pushState(null, '', `#${tab}`);
  }

  function openDrill(project?: string, item?: number) {
    if (savingUpdate) return;
    setShowIssueForm(false);
    navigateTo('hierarchy');
    setDrillProjectId(project ?? ''); setDrillItemId(item ?? null);
    const params = new URLSearchParams();
    if (project) params.set('project', project);
    if (item) params.set('item', String(item));
    window.history.replaceState(null, '', `#hierarchy${params.size ? `?${params}` : ''}`);
  }

  function createChild(type: string, project: Project, parent?: WorkItem) {
    setIssueDraft({ ...emptyIssue, type, project: project.name, parentId: parent ? String(parent.id) : '' });
    setEditingIssueId(null); setShowIssueForm(true);
    setOpen((current) => ({ ...current, issues: true }));
  }

  useEffect(() => {
    const savedTheme = localStorage.getItem('sirius-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') setTheme(savedTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('sirius-theme', theme);
  }, [theme]);

  async function load() {
    setLoading(true);
    setMessage('');
    const issueUrl = '/api/issues';
    const [issueResponse, projectResponse, repoResponse] = await Promise.all([
      fetch(issueUrl),
      fetch('/api/projects'),
      fetch('/api/repos'),
    ]);
    const issueData = await issueResponse.json();
    const projectData = await projectResponse.json();
    const repoData = await repoResponse.json();
    if (!issueResponse.ok || !projectResponse.ok || !repoResponse.ok) {
      setLoading(false);
      throw new Error(issueData.error ?? projectData.error ?? repoData.error ?? 'Could not load workspace data.');
    }
    setIssues(issueData.issues ?? []);
    setProjects(projectData.projects ?? []);
    setRepos(repoData.repositories ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load().catch((error) => {
      setMessage(String(error));
      setLoading(false);
    });
  }, []);

  const filteredIssues = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return issues.filter((issue) => {
      const type = field(issue, 'Work Item Type');
      const sprint = field(issue, 'Sprint');
      return (
        (!projectId || String(issue.project?.id) === projectId) &&
        (!typeFilter || type === typeFilter) &&
        (!sprintFilter || sprint.toLowerCase().includes(sprintFilter.toLowerCase())) &&
        (!needle || String(issue.id) === needle || issue.summary.toLowerCase().includes(needle))
      );
    });
  }, [issues, projectId, query, sprintFilter, typeFilter]);

  const isWorkTab = activeTab === 'tasks' || activeTab === 'features' || activeTab === 'bugs';
  const activeTabLabel = workspaceTabs.find((tab) => tab.id === activeTab)!.label;
  const organizationProblems = useMemo(() => hierarchyProblems(issues), [issues]);
  const boardIssues = filteredIssues.filter((issue) => workTabForType(field(issue, 'Work Item Type')) === activeTab && !organizationProblems.has(issue.id));
  const boardUnorganized = filteredIssues.filter((issue) => workTabForType(field(issue, 'Work Item Type')) === activeTab && organizationProblems.has(issue.id));
  const editorVisible = showIssueForm && (activeTab === 'hierarchy' || (isWorkTab && workTabForType(issueDraft.type) === activeTab));
  const newItemLabel = activeTab === 'features' ? 'Feature' : activeTab === 'bugs' ? 'Bug' : 'Task';
  const editorLabel = issueDraft.type === 'User Story' ? 'Story' : issueDraft.type || 'Work Item';

  const selectedProject = projects.find((project) => project.name === issueDraft.project);
  useEffect(() => {
    let active = true;
    setAssignees([]); setAssigneeState('idle');
    if (!editorVisible || !selectedProject) return;
    setAssigneeState('loading');
    void fetch(`/api/projects/${selectedProject.id}/handlers`).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not load assignees.');
      if (active) { setAssignees(data.users ?? []); setAssigneeState('ready'); }
    }).catch(() => { if (active) setAssigneeState('failed'); });
    return () => { active = false; };
  }, [editorVisible, selectedProject?.id]);
  const parentCandidates = issues.filter((parent) => {
    try {
      validateParent({ id: editingIssueId ?? 0, summary: issueDraft.summary, project: selectedProject, custom_fields: [{ field: { name: 'Work Item Type' }, value: issueDraft.type }] }, parent.id, issues);
      return true;
    } catch { return false; }
  });
  const issueCategories = selectedProject?.categories ?? [];
  const updateTask = issues.find((issue) => issue.id === editingIssueId);
  const taskRepositories = repos.filter((repo) => repo.project === updateTask?.project?.name);
  const updateRepository = updateRepoName || (taskRepositories.length === 1 ? taskRepositories[0].repoName : '');
  const commitDraft = commitOverride ?? (updateTask && updateText.trim()
    ? draftCommitMessage(updateTask.id, updateTask.summary, updateText) : '');

  const releaseSummary = useMemo(
    () => readinessValues.map((value) => ({
      value,
      count: filteredIssues.filter((issue) => (field(issue, 'Release Readiness') || 'Not Assessed') === value).length,
    })),
    [filteredIssues],
  );

  const reports = useMemo(() => [
    { title: 'Status', rows: reportCounts(filteredIssues, (issue) => issue.status?.name ?? '') },
    { title: 'Type', rows: reportCounts(filteredIssues, workType) },
    { title: 'Sprint', rows: reportCounts(filteredIssues, (issue) => field(issue, 'Sprint')) },
    { title: 'Project', rows: reportCounts(filteredIssues, (issue) => issue.project?.name ?? '') },
    { title: 'Readiness', rows: reportCounts(filteredIssues, (issue) => field(issue, 'Release Readiness') || 'Not Assessed') },
    { title: 'Verification', rows: reportCounts(filteredIssues, (issue) => field(issue, 'Verification Result') || 'Unverified') },
  ], [filteredIssues]);

  const projectMetrics = useMemo(() => projects.map((project) => {
    const projectIssues = issues.filter((issue) => issue.project?.name === project.name);
    return {
      project,
      issues: projectIssues.length,
      repos: repos.filter((repo) => repo.project === project.name).length,
      blocked: projectIssues.filter((issue) => field(issue, 'Release Readiness') === 'Blocked').length,
      ready: projectIssues.filter((issue) => field(issue, 'Release Readiness') === 'Ready').length,
    };
  }), [issues, projects, repos]);

  function togglePanel(key: keyof typeof open) {
    setOpen((current) => ({ ...current, [key]: !current[key] }));
  }

  function issueToDraft(issue: Issue): IssueDraft {
    return {
      id: issue.id,
      project: issue.project?.name ?? '',
      category: issue.category?.name ?? '',
      summary: issue.summary,
      description: issue.description ?? '',
      status: issue.status?.name ?? '',
      type: field(issue, 'Work Item Type'),
      sprint: field(issue, 'Sprint'),
      storyPoints: field(issue, 'Story Points'),
      parentId: field(issue, 'Parent Issue'),
      assigneeId: issue.handler?.id ? String(issue.handler.id) : '',
      deviceInfo: field(issue, 'Device Information'),
      appVersion: field(issue, 'Application Version'),
      osVersion: field(issue, 'Operating System Version'),
      logs: field(issue, 'Relevant Logs'),
      verification: field(issue, 'Verification Result') || 'Unverified',
      releaseReadiness: field(issue, 'Release Readiness') || 'Not Assessed',
    };
  }

  async function changeWorkItem(issueId: number, change: { status?: string; parentId?: string }) {
    setMessage('');
    try {
    const response = await fetch(`/api/issues/${issueId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(change),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? `Could not update #${issueId}.`);
    }
    await load();
    if (editingIssueId === issueId) setIssueDraft((current) => ({ ...current, ...change }));
    return true;
    } catch (error) { setMessage(String(error)); return false; }
  }

  async function saveIssue() {
    if (busyEditors.size) return;
    setMessage('');
    const response = await fetch(editingIssueId === null ? '/api/issues' : `/api/issues/${editingIssueId}`, {
      method: editingIssueId === null ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(issueDraft),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setMessage(body.error ?? 'Could not save issue.');
      return;
    }
    setIssueDraft(emptyIssue);
    setEditingIssueId(null);
    setShowIssueForm(false);
    await load();
  }

  async function saveTaskUpdate() {
    if (busyEditors.size) return;
    if (savingUpdate || updateSaved || !updateTask) return;
    setSavingUpdate(true);
    setMessage('');
    try {
      const response = await fetch(`/api/issues/${updateTask.id}/updates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoName: updateRepository, updateText, commitMessage: commitDraft }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not save task update.');
      setCommitOverride(body.commitMessage);
      setUpdateSaved(true);
      setMessage(`Update saved to Mantis #${updateTask.id}. Commit draft ready.`);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setSavingUpdate(false);
    }
  }

  async function copyCommitMessage() {
    try {
      await navigator.clipboard.writeText(commitDraft);
      setMessage('Commit message copied.');
    } catch {
      setMessage('Clipboard unavailable. Select the commit message text to copy it.');
    }
  }

  async function deleteIssue(issueId: number) {
    setMessage('');
    const response = await fetch(`/api/issues/${issueId}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setMessage(body.error ?? `Could not delete issue #${issueId}.`);
      return;
    }
    setIssueDraft(emptyIssue);
    setEditingIssueId(null);
    setMenu(null);
    await load();
  }

  async function saveProject() {
    if (busyEditors.size) return;
    setMessage('');
    const response = await fetch(editingProjectId === null ? '/api/projects' : `/api/projects/${editingProjectId}`, {
      method: editingProjectId === null ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(projectDraft),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setMessage(body.error ?? 'Could not save project.');
      return;
    }
    setProjectDraft(emptyProject);
    setEditingProjectId(null);
    setShowProjectForm(false);
    await load();
  }

  async function deleteProject(project: Project) {
    setMessage('');
    const response = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setMessage(body.error ?? `Could not delete ${project.name}.`);
      return;
    }
    setMenu(null);
    await load();
  }

  async function saveRepo() {
    if (busyEditors.size) return;
    setMessage('');
    const url = editingRepo === null ? '/api/repos' : `/api/repos/${encodeURIComponent(editingRepo.project)}/${encodeURIComponent(editingRepo.repoName)}`;
    const response = await fetch(url, {
      method: editingRepo === null ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(repoDraft),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setMessage(body.error ?? 'Could not save repository.');
      return;
    }
    setRepoDraft(emptyRepo);
    setEditingRepo(null);
    setShowRepoForm(false);
    await load();
  }

  async function deleteRepo(repo: RepoEntry) {
    setMessage('');
    const response = await fetch(`/api/repos/${encodeURIComponent(repo.project)}/${encodeURIComponent(repo.repoName)}`, { method: 'DELETE' });
    if (!response.ok) {
      setMessage('Could not delete repository.');
      return;
    }
    setMenu(null);
    await load();
  }

  function editProject(project: Project) {
    navigateTo('projects');
    setShowProjectForm(true);
    setEditingProjectId(project.id);
    setProjectDraft({
      id: project.id,
      name: project.name,
      description: project.description ?? '',
      status: project.status?.name ?? 'development',
      view_state: project.view_state?.name ?? 'public',
      enabled: project.enabled ?? true,
    });
    setOpen((current) => ({ ...current, projects: true }));
    setMenu(null);
  }

  function editIssue(issue: Issue) {
    if (savingUpdate) return;
    navigateTo(workTabForType(field(issue, 'Work Item Type')));
    setShowIssueForm(true);
    setUpdateRepoName('');
    setUpdateText('');
    setCommitOverride(null);
    setUpdateSaved(false);
    setIssueDraft(issueToDraft(issue));
    setEditingIssueId(issue.id);
    setOpen((current) => ({ ...current, issues: true }));
    setMenu(null);
  }

  function editRepo(repo: RepoEntry) {
    navigateTo('repos');
    setShowRepoForm(true);
    setRepoDraft(repo);
    setEditingRepo({ project: repo.project, repoName: repo.repoName });
    setOpen((current) => ({ ...current, repos: true }));
    setMenu(null);
  }

  return (
    <CardDetailsProvider projects={projects} items={issues} repositories={repos}><main className="appShell">
      <section className="workspace" id="dashboard">
        <header className="hero">
          <div>
            <h1>Sirius Scientific DevOps</h1>
          </div>
          <div className="heroActions">
            <button type="button" className="ghostButton" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Light' : 'Dark'} theme</button>
            <button type="button" onClick={() => void load()}>Refresh</button>
            <a className="primaryLink" href="http://127.0.0.1:8877" target="_blank" rel="noreferrer">Open MantisBT</a>
          </div>
        </header>

        <nav className="workspaceTabs" role="tablist" aria-label="Workspace">
          {workspaceTabs.map((tab, index) => <a key={tab.id} href={`#${tab.id}`} role="tab" id={`tab-${tab.id}`} aria-selected={activeTab === tab.id} aria-controls="workspace-content" tabIndex={activeTab === tab.id ? 0 : -1} onClick={(event) => { event.preventDefault(); navigateTo(tab.id); }} onKeyDown={(event) => {
            const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
            const target = event.key === 'Home' ? 0 : event.key === 'End' ? workspaceTabs.length - 1 : offset ? (index + offset + workspaceTabs.length) % workspaceTabs.length : -1;
            if (target < 0) return;
            event.preventDefault();
            navigateTo(workspaceTabs[target].id);
            document.getElementById(`tab-${workspaceTabs[target].id}`)?.focus();
          }}>{tab.label}</a>)}
        </nav>

        <div id="workspace-content" role="tabpanel" aria-labelledby={`tab-${activeTab}`}>
        <div className="viewHeading">
          <h2>{activeTabLabel}</h2>
          {isWorkTab ? <button type="button" disabled={savingUpdate} onClick={() => {
            setIssueDraft({ ...emptyIssue, type: newItemLabel, project: projects.find((project) => String(project.id) === projectId)?.name ?? '' });
            setEditingIssueId(null); setShowIssueForm(true); setOpen((current) => ({ ...current, issues: true }));
          }}>New {newItemLabel}</button> : null}
          {activeTab === 'projects' ? <button type="button" onClick={() => { setProjectDraft(emptyProject); setEditingProjectId(null); setShowProjectForm(true); setOpen((current) => ({ ...current, projects: true })); }}>New Project</button> : null}
          {activeTab === 'repos' ? <button type="button" onClick={() => { setRepoDraft(emptyRepo); setEditingRepo(null); setShowRepoForm(true); setOpen((current) => ({ ...current, repos: true })); }}>Link Repository</button> : null}
        </div>

        {activeTab === 'overview' ? <>
        <section className="metricGrid" aria-label="Dashboard overview">
          <article className="metricCard liftCard"><div className="cardDetailTopline"><span>Projects</span><CardViewButton label="Projects" target={{ kind: 'summary', title: 'Projects', fields: [{ name: 'Total', value: projects.length }, { name: 'Enabled', value: projects.filter((project) => project.enabled !== false).length }], projectIds: projects.map((project) => project.id) }} /></div><strong>{projects.length}</strong><small>{projects.filter((project) => project.enabled !== false).length} enabled</small></article>
          <article className="metricCard liftCard"><div className="cardDetailTopline"><span>Work Items</span><CardViewButton label="Work Items" target={{ kind: 'summary', title: 'Work Items', fields: [{ name: 'Matching items', value: filteredIssues.length }, { name: 'Loaded items', value: issues.length }], itemIds: filteredIssues.map((issue) => issue.id) }} /></div><strong>{filteredIssues.length}</strong><small>{issues.length} loaded</small></article>
          <article className="metricCard liftCard"><div className="cardDetailTopline"><span>Repositories</span><CardViewButton label="Repositories" target={{ kind: 'summary', title: 'Repositories', fields: [{ name: 'Mapped sources', value: repos.length }], repositories: repos.map(({ project, repoName }) => ({ project, repoName })) }} /></div><strong>{repos.length}</strong><small>mapped sources</small></article>
          <article className="metricCard liftCard"><div className="cardDetailTopline"><span>Needs organization</span><CardViewButton label="Needs organization" target={{ kind: 'summary', title: 'Needs organization', fields: [{ name: 'Items', value: organizationProblems.size }, { name: 'Unclassified', value: issues.filter((issue) => workType(issue) === 'Unclassified').length }], itemIds: issues.filter((issue) => organizationProblems.has(issue.id)).map((issue) => issue.id) }} /></div><strong>{organizationProblems.size}</strong><small>{issues.filter((issue) => workType(issue) === 'Unclassified').length} unclassified</small></article>
        </section>
        <div className="overviewLinks">{workspaceTabs.slice(1).map((tab) => <a key={tab.id} href={`#${tab.id}`} onClick={(event) => { event.preventDefault(); navigateTo(tab.id); }}>{tab.label}<span aria-hidden="true">&#8594;</span></a>)}</div>
        <h3>Projects</h3>
        <div className="projectCards">{projects.map((project) => <article key={project.id} className="projectCard" onClick={(event) => { if (!(event.target as HTMLElement).closest('button,a,input,select,textarea,summary')) openDrill(String(project.id)); }}><div className="cardDetailTopline"><button type="button" className="drillTitle" onClick={() => openDrill(String(project.id))}>{project.name}</button><CardViewButton label={project.name} target={{ kind: 'project', id: project.id }} /></div><RichContent compact value={project.description ?? ''} /><span>{issues.filter((issue) => issue.project?.id === project.id).length} work items</span><ProjectApiLinks projectId={project.id} /></article>)}</div>
        </> : null}

        {isWorkTab || activeTab === 'reports' ? <section className="filters commandBar" aria-label="Work filters">
          <label>Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">All projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label>Work item type<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="">All types</option>{workTypes.filter((type) => !isWorkTab || workTabForType(type) === activeTab).map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
          <label>Sprint<input value={sprintFilter} onChange={(event) => setSprintFilter(event.target.value)} placeholder="Sprint name" /></label>
          <label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Issue id or title" /></label>
        </section> : null}

        {message ? <p className="message">{message}</p> : null}
        {loading ? <p className="loading">Loading work items...</p> : null}

        {activeTab === 'projects' ? <Panel id="projects" title="Project Portfolio" open={open.projects} onToggle={() => togglePanel('projects')}>
          {showProjectForm ? <div className="projectForm premiumForm">
            <label>Name<input value={projectDraft.name} onChange={(event) => setProjectDraft({ ...projectDraft, name: event.target.value })} placeholder="Project name" /></label>
            <div className="fullField"><RichEditor key={`project-${editingProjectId ?? 'new'}`} label="Project description" value={projectDraft.description} projectId={editingProjectId ?? undefined} onChange={(description) => setProjectDraft((current) => ({ ...current, description }))} onBusyChange={(busy) => editorBusy('project', busy)} /></div>
            <label>Status<select value={projectDraft.status} onChange={(event) => setProjectDraft({ ...projectDraft, status: event.target.value })}><option value="development">Development</option><option value="release">Release</option><option value="stable">Stable</option><option value="obsolete">Obsolete</option></select></label>
            <label>Visibility<select value={projectDraft.view_state} onChange={(event) => setProjectDraft({ ...projectDraft, view_state: event.target.value })}><option value="public">Public</option><option value="private">Private</option></select></label>
            <label className="checkboxLabel"><input type="checkbox" checked={projectDraft.enabled} onChange={(event) => setProjectDraft({ ...projectDraft, enabled: event.target.checked })} />Enabled</label>
            <button type="button" disabled={busyEditors.size > 0} onClick={() => void saveProject()}>{editingProjectId === null ? 'Create Project' : 'Save Project'}</button>
            <button type="button" className="ghostButton" onClick={() => { setProjectDraft(emptyProject); setEditingProjectId(null); setShowProjectForm(false); }}>Cancel</button>
          </div> : null}
          <div className="projectCards">
            {projectMetrics.map(({ project, issues: count, repos: repoCount, blocked, ready }) => (
              <article className="projectCard liftCard" key={project.id} onClick={(event) => { if (!(event.target as HTMLElement).closest('button,a,input,select,textarea,summary')) openDrill(String(project.id)); }}>
                <div className="cardTopline">
                  <span>{project.status?.label ?? project.status?.name ?? 'development'}</span>
                  <CardViewButton label={project.name} target={{ kind: 'project', id: project.id }} />
                  <button type="button" className="iconButton" onClick={() => setMenu(menu === `project-${project.id}` ? null : `project-${project.id}`)}>...</button>
                  {menu === `project-${project.id}` ? <ContextMenu><button type="button" onClick={() => editProject(project)}>Edit</button><button type="button" onClick={() => { setProjectId(String(project.id)); navigateTo('tasks'); }}>View Tasks</button><button type="button" onClick={() => void deleteProject(project)}>Delete</button></ContextMenu> : null}
                </div>
                <button type="button" className="drillTitle" onClick={() => openDrill(String(project.id))}>{project.name}</button>
                <RichContent compact value={project.description || 'No description recorded.'} />
                <div className="miniStats"><span>{count}<small>items</small></span><span>{repoCount}<small>repos</small></span><span>{ready}<small>ready</small></span><span>{blocked}<small>blocked</small></span></div>
                <ProjectApiLinks projectId={project.id} />
              </article>
            ))}
          </div>
        </Panel> : null}

        {editorVisible ? <Panel id="work" title={`${editingIssueId === null ? 'New' : 'Edit'} ${editorLabel}${editingIssueId === null ? '' : ` #${editingIssueId}`}`} open={open.issues} onToggle={() => togglePanel('issues')}>
          <div className="issueForm premiumForm">
            <label>Project<select value={issueDraft.project} onChange={(event) => setIssueDraft({ ...issueDraft, project: event.target.value, category: '', parentId: '', assigneeId: '' })}><option value="">Select project</option>{projects.map((project) => <option key={project.id} value={project.name}>{project.name}</option>)}</select></label>
            <label>Category<select value={issueDraft.category} onChange={(event) => setIssueDraft({ ...issueDraft, category: event.target.value })}><option value="">Select category</option>{issueCategories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}</select></label>
            <label>Type<select value={issueDraft.type} onChange={(event) => { setIssueDraft({ ...issueDraft, type: event.target.value, parentId: '' }); if (activeTab !== 'hierarchy') navigateTo(workTabForType(event.target.value)); }}><option value="">Select type</option>{workTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
            <label>Status<select value={issueDraft.status} onChange={(event) => setIssueDraft({ ...issueDraft, status: event.target.value })}><option value="">Default</option>{columns.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></label>
            <label>Assigned to<select disabled={assigneeState !== 'ready'} value={issueDraft.assigneeId} onChange={(event) => setIssueDraft({ ...issueDraft, assigneeId: event.target.value })}><option value="">{assigneeState === 'loading' ? 'Loading people...' : assigneeState === 'failed' ? 'People unavailable' : 'Unassigned'}</option>{assignees.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}{issueDraft.assigneeId && !assignees.some((person) => String(person.id) === issueDraft.assigneeId) ? <option value={issueDraft.assigneeId}>Current assignee #{issueDraft.assigneeId} (unavailable)</option> : null}</select></label>
            {assigneeState === 'failed' ? <p role="alert">Could not load eligible people. Close and reopen the editor to retry.</p> : null}
            <label className="wideField">Summary<input value={issueDraft.summary} onChange={(event) => setIssueDraft({ ...issueDraft, summary: event.target.value })} /></label>
            <div className="fullField"><RichEditor key={`description-${editingIssueId ?? 'new'}`} label="Description" value={issueDraft.description} projectId={selectedProject?.id} onChange={(description) => setIssueDraft((current) => ({ ...current, description }))} onBusyChange={(busy) => editorBusy('description', busy)} /></div>
            <label>Sprint<input value={issueDraft.sprint} onChange={(event) => setIssueDraft({ ...issueDraft, sprint: event.target.value })} /></label>
            <label>Story points<input value={issueDraft.storyPoints} onChange={(event) => setIssueDraft({ ...issueDraft, storyPoints: event.target.value })} /></label>
            <label>Parent item<select value={issueDraft.parentId} onChange={(event) => setIssueDraft({ ...issueDraft, parentId: event.target.value })}><option value="">{issueDraft.type === 'Epic' ? 'Project root' : 'Select required parent'}</option>{parentCandidates.map((parent) => <option key={parent.id} value={parent.id}>#{parent.id} {workType(parent)}: {parent.summary}</option>)}{issueDraft.parentId && !parentCandidates.some((parent) => String(parent.id) === issueDraft.parentId) ? <option value={issueDraft.parentId}>#{issueDraft.parentId} (unavailable or invalid)</option> : null}</select></label>
            <label>Verification<select value={issueDraft.verification} onChange={(event) => setIssueDraft({ ...issueDraft, verification: event.target.value })}>{['Unverified', 'Passed', 'Failed', 'Blocked', 'Not Required'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>Release readiness<select value={issueDraft.releaseReadiness} onChange={(event) => setIssueDraft({ ...issueDraft, releaseReadiness: event.target.value })}>{readinessValues.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>Device<input value={issueDraft.deviceInfo} onChange={(event) => setIssueDraft({ ...issueDraft, deviceInfo: event.target.value })} /></label>
            <label>App version<input value={issueDraft.appVersion} onChange={(event) => setIssueDraft({ ...issueDraft, appVersion: event.target.value })} /></label>
            <label>OS version<input value={issueDraft.osVersion} onChange={(event) => setIssueDraft({ ...issueDraft, osVersion: event.target.value })} /></label>
            <div className="fullField"><RichEditor key={`logs-${editingIssueId ?? 'new'}`} label="Relevant logs" value={issueDraft.logs} projectId={selectedProject?.id} onChange={(logs) => setIssueDraft((current) => ({ ...current, logs }))} onBusyChange={(busy) => editorBusy('logs', busy)} /></div>
            <div className="formActions"><button type="button" disabled={savingUpdate || assigneeState !== 'ready' || !issueDraft.type || (issueDraft.type !== 'Epic' && !parentCandidates.some((parent) => String(parent.id) === issueDraft.parentId))} onClick={() => void saveIssue()}>{editingIssueId === null ? `Create ${editorLabel}` : 'Save Changes'}</button><button type="button" disabled={savingUpdate} className="ghostButton" onClick={() => { setIssueDraft(emptyIssue); setEditingIssueId(null); setShowIssueForm(false); }}>Cancel</button>{editingIssueId !== null ? <a className="primaryLink" href={`http://127.0.0.1:8877/view.php?id=${editingIssueId}`} target="_blank" rel="noreferrer">Open</a> : null}</div>
          </div>
          {updateTask ? <ChildAssignments key={updateTask.id} item={updateTask} items={issues} onChange={changeWorkItem} onOpen={openDrill} onCreate={(type, project, parent) => { if (JSON.stringify(issueDraft) !== JSON.stringify(issueToDraft(updateTask)) && !window.confirm('Discard unsaved item changes and create a child?')) return; navigateTo('hierarchy'); createChild(type, project, parent); }} /> : null}
          {updateTask ? <fieldset disabled={savingUpdate}>
            <legend>Task #{updateTask.id}: Progress And Commit Draft</legend>
            <div className="issueForm premiumForm">
              <label className="fullField">Repository<select disabled={updateSaved} value={updateRepository} onChange={(event) => setUpdateRepoName(event.target.value)}><option value="">Select repository</option>{taskRepositories.map((repo) => <option key={repo.repoName} value={repo.repoName}>{repo.repoName}</option>)}</select></label>
              {taskRepositories.length === 0 ? <p className="fullField">No repository linked to this project. <a href="#repos">Repository Registry</a></p> : null}
              <div className="fullField"><RichEditor key={`progress-${updateTask.id}`} label="Progress update" readOnly={updateSaved || savingUpdate} projectId={updateTask.project?.id} value={updateText} onChange={(value) => { setUpdateText(value); setCommitOverride(null); }} onBusyChange={(busy) => editorBusy('progress', busy)} /></div>
              <label className="fullField">Commit message<textarea value={commitDraft} readOnly={updateSaved} onChange={(event) => setCommitOverride(event.target.value)} /></label>
              <div className="formActions">
                <button type="button" disabled={busyEditors.size > 0 || updateSaved || !updateRepository || !updateText.trim() || !commitDraft.trim()} onClick={() => void saveTaskUpdate()}>{savingUpdate ? 'Saving Update...' : updateSaved ? 'Update Saved' : 'Save Update'}</button>
                <button type="button" disabled={!commitDraft.trim()} onClick={() => void copyCommitMessage()}>Copy Commit Message</button>
                <button type="button" disabled={updateSaved || !updateText.trim()} onClick={() => setCommitOverride(null)}>Regenerate Draft</button>
                {updateSaved ? <button type="button" onClick={() => { setUpdateText(''); setCommitOverride(null); setUpdateSaved(false); }}>New Update</button> : null}
              </div>
            </div>
          </fieldset> : null}
        </Panel> : null}

        {activeTab === 'reports' ? <Panel id="reports" title="Intelligence And Reports" open={open.reports} onToggle={() => togglePanel('reports')}>
          <div className="releaseSummary">{releaseSummary.map((item) => <div className="releaseSummaryItem liftCard" key={item.value}><div className="cardDetailTopline"><span>{item.value}</span><CardViewButton label={item.value} target={{ kind: 'summary', title: item.value, fields: [{ name: 'Matching items', value: item.count }], itemIds: filteredIssues.filter((issue) => (field(issue, 'Release Readiness') || 'Not Assessed') === item.value).map((issue) => issue.id) }} /></div><strong>{item.count}</strong></div>)}</div>
          <div className="reportGrid">{reports.map((report) => <article className="reportCard liftCard" key={report.title}><div className="cardDetailTopline"><h3>{report.title}</h3><CardViewButton label={`${report.title} report`} target={{ kind: 'summary', title: `${report.title} report`, fields: report.rows.map((row) => ({ name: label(row.name), value: row.count })), itemIds: filteredIssues.map((issue) => issue.id) }} /></div>{report.rows.length === 0 ? <p className="emptyState">No matching work items.</p> : <dl>{report.rows.map((row) => <div key={row.name}><dt>{label(row.name)}</dt><dd>{row.count}</dd></div>)}</dl>}</article>)}</div>
        </Panel> : null}

        {activeTab === 'repos' ? <Panel id="repos" title="Repository Registry" open={open.repos} onToggle={() => togglePanel('repos')}>
          {showRepoForm ? <div className="repoForm premiumForm">
            <label>Project<select value={repoDraft.project} onChange={(event) => setRepoDraft({ ...repoDraft, project: event.target.value })}><option value="">Select project</option>{projects.map((project) => <option key={project.id} value={project.name}>{project.name}</option>)}</select></label>
            <label>Repo name<input value={repoDraft.repoName} onChange={(event) => setRepoDraft({ ...repoDraft, repoName: event.target.value })} /></label>
            <label>Provider<select value={repoDraft.provider} onChange={(event) => setRepoDraft({ ...repoDraft, provider: event.target.value })}><option value="github">GitHub</option><option value="gitlab">GitLab</option><option value="azure-devops">Azure DevOps</option><option value="other">Other</option></select></label>
            <label>URL<input value={repoDraft.url} onChange={(event) => setRepoDraft({ ...repoDraft, url: event.target.value })} /></label>
            <label>Branch<input value={repoDraft.defaultBranch} onChange={(event) => setRepoDraft({ ...repoDraft, defaultBranch: event.target.value })} /></label>
            <label>Local path<input value={repoDraft.localPath ?? ''} onChange={(event) => setRepoDraft({ ...repoDraft, localPath: event.target.value })} /></label>
            <div className="fullField"><RichEditor key={`notes-${editingRepo?.repoName ?? 'new'}`} label="Repository notes" value={repoDraft.notes ?? ''} projectId={projects.find((entry) => entry.name === repoDraft.project)?.id} onChange={(notes) => setRepoDraft((current) => ({ ...current, notes }))} onBusyChange={(busy) => editorBusy('notes', busy)} /></div>
            <button type="button" disabled={busyEditors.size > 0} onClick={() => void saveRepo()}>{editingRepo === null ? 'Add Repo' : 'Save Repo'}</button>
            <button type="button" className="ghostButton" onClick={() => setShowRepoForm(false)}>Cancel</button>
          </div> : null}
          <div className="repoCards">{repos.length === 0 ? <p className="emptyState">No repositories registered yet.</p> : null}{repos.map((repo) => <article className="repoCard liftCard" key={`${repo.project}:${repo.repoName}`}><div className="cardTopline"><span>{repo.project}</span><CardViewButton label={repo.repoName} target={{ kind: 'repository', project: repo.project, repoName: repo.repoName }} /><button type="button" className="iconButton" onClick={() => setMenu(menu === `repo-${repo.project}-${repo.repoName}` ? null : `repo-${repo.project}-${repo.repoName}`)}>...</button>{menu === `repo-${repo.project}-${repo.repoName}` ? <ContextMenu><button type="button" onClick={() => editRepo(repo)}>Edit</button><a href={repo.url} target="_blank" rel="noreferrer">Open URL</a><button type="button" onClick={() => void deleteRepo(repo)}>Delete</button></ContextMenu> : null}</div><h3>{repo.repoName}</h3><p>{repo.url}</p><small>{repo.provider} / {repo.defaultBranch}</small></article>)}</div>
        </Panel> : null}

        {activeTab === 'hierarchy' && !loading ? <HierarchyExplorer projects={projects} items={issues} projectId={drillProjectId} itemId={drillItemId} onNavigate={openDrill} onOverview={() => navigateTo('overview')} onEdit={(item) => { setShowIssueForm(true); setIssueDraft(issueToDraft(item as Issue)); setEditingIssueId(item.id); setOpen((current) => ({ ...current, issues: true })); setUpdateRepoName(''); setUpdateText(''); setCommitOverride(null); setUpdateSaved(false); }} onCreate={createChild} onChange={changeWorkItem} /> : null}

        {isWorkTab ? <Panel id="board" title={`${activeTabLabel} Board`} open={open.board} onToggle={() => togglePanel('board')}>
          {boardUnorganized.length ? <div className="workToolbar"><p className="hierarchyWarning">{boardUnorganized.length} items have incomplete hierarchy.</p><button type="button" className="ghostButton" onClick={() => openDrill(projectId || undefined)}>Review Organization</button></div> : null}
          {boardIssues.length === 0 && !loading ? <p className="emptyState">No {activeTabLabel.toLowerCase()} match the current filters.</p> : null}
          <WorkBoard items={boardIssues} onEdit={(item: WorkItem) => editIssue(item as Issue)} onOpen={(item) => openDrill(String(item.project?.id), item.id)} onChange={changeWorkItem} onDelete={deleteIssue} />
        </Panel> : null}
        </div>
      </section>
    </main></CardDetailsProvider>
  );
}

function Panel({ id, title, open, onToggle, children }: { id: string; title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return <section className="panel" id={id}><button type="button" className="panelHeader" onClick={onToggle} aria-expanded={open}><span>{title}</span><strong>{open ? '-' : '+'}</strong></button>{open ? <div className="panelBody">{children}</div> : null}</section>;
}

function ContextMenu({ children }: { children: React.ReactNode }) {
  return <div className="contextMenu">{children}</div>;
}
