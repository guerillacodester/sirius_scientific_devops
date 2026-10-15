export const workspaceTabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'projects', label: 'Projects' },
  { id: 'hierarchy', label: 'Hierarchy' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'features', label: 'Features' },
  { id: 'bugs', label: 'Bugs' },
  { id: 'reports', label: 'Reports' },
  { id: 'repos', label: 'Repositories' },
] as const;

export type WorkspaceTab = typeof workspaceTabs[number]['id'];

export function tabFromHash(hash: string): WorkspaceTab {
  const value = hash.replace(/^#/, '').split('?')[0];
  if (value === 'work' || value === 'board') return 'tasks';
  return workspaceTabs.find((tab) => tab.id === value)?.id ?? 'overview';
}

export function workTabForType(type: string): 'tasks' | 'features' | 'bugs' | 'hierarchy' {
  if (type === 'Bug') return 'bugs';
  if (['Epic', 'Feature', 'User Story', 'Improvement'].includes(type)) return 'features';
  if (['Task', 'Technical Debt'].includes(type)) return 'tasks';
  return 'hierarchy';
}
