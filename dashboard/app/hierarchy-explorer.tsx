'use client';

import { useEffect, useMemo, useState } from 'react';
import { hierarchyProblems, parentId, validateParent, workType, type WorkItem } from './hierarchy';
import { HierarchyTree, startDrag, draggedId } from './work-items';
import { ProjectApiLinks } from './project-api-links';
import { CardViewButton } from './card-details';
import { RichContent } from './rich-content';

type Project = { id: number; name: string; description?: string };
const cardViews = [
  { value: 'Epic', label: 'Epics' },
  { value: 'User Story', label: 'Stories' },
  { value: 'Feature', label: 'Features' },
  { value: 'Task', label: 'Tasks' },
  { value: 'Bug', label: 'Bugs' },
];
type Props = {
  projects: Project[];
  items: WorkItem[];
  projectId: string;
  itemId: number | null;
  onNavigate: (projectId?: string, itemId?: number) => void;
  onOverview: () => void;
  onEdit: (item: WorkItem) => void;
  onCreate: (type: string, project: Project, parent?: WorkItem) => void;
  onChange: (id: number, change: { status?: string; parentId?: string }) => Promise<boolean>;
};

export function HierarchyExplorer({ projects, items, projectId, itemId, onNavigate, onOverview, onEdit, onCreate, onChange }: Props) {
  const [mode, setMode] = useState('cards');
  const [viewType, setViewType] = useState('');
  const [review, setReview] = useState(false);
  const [compact, setCompact] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  useEffect(() => { setReview(false); setError(''); setViewType(''); }, [projectId, itemId]);
  const project = projects.find((entry) => String(entry.id) === projectId);
  const projectItems = items.filter((entry) => entry.project?.id === project?.id);
  const selected = projectItems.find((entry) => entry.id === itemId);
  const scopedItems = project ? projectItems : items;
  const audit = useMemo(() => hierarchyProblems(items), [items]);
  const invalid = scopedItems.filter((entry) => audit.get(entry.id));
  const directChildren = projectItems.filter((entry) => !audit.get(entry.id) && (selected ? parentId(entry) === selected.id : workType(entry) === 'Epic'));
  const visibleCards = review ? invalid : viewType ? scopedItems.filter((entry) => workType(entry) === viewType) : directChildren;
  const viewLabel = cardViews.find((entry) => entry.value === viewType)?.label;
  const chain: WorkItem[] = [];
  const visited = new Set<number>();
  let ancestor = selected;
  while (ancestor && !visited.has(ancestor.id)) {
    chain.unshift(ancestor); visited.add(ancestor.id);
    const next = parentId(ancestor);
    ancestor = projectItems.find((entry) => entry.id === next);
  }
  const nextType = !selected ? 'Epic' : ({ Epic: 'User Story', 'User Story': 'Feature', Feature: 'Task', Task: 'Bug' } as Record<string, string>)[workType(selected)];
  function navigate(projectId?: string, itemId?: number) { setReview(false); setError(''); setViewType(''); onNavigate(projectId, itemId); }
  function toggle(id: number) { setCollapsed((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; }); }
  async function drop(id: number, parent: WorkItem) {
    const child = items.find((entry) => entry.id === id);
    if (!child) return;
    try { validateParent(child, parent.id, items); setError(''); await onChange(id, { parentId: String(parent.id) }); }
    catch (failure) { setError(String(failure)); }
  }
  const missingItem = itemId !== null && !selected;
  return <section className="drillExplorer" aria-label="Hierarchy explorer">
    <nav className="breadcrumbs" aria-label="Hierarchy breadcrumbs">
      <button type="button" onClick={onOverview}>Overview</button><span>/</span>
      <button type="button" onClick={() => navigate()}>Projects</button>
      {project ? <><span>/</span><button type="button" onClick={() => navigate(String(project.id))}>{project.name}</button></> : null}
      {chain.map((entry) => <span className="breadcrumbItem" key={entry.id}><span>/</span><button type="button" onClick={() => navigate(projectId, entry.id)}>{workType(entry)} #{entry.id}</button></span>)}
    </nav>
    <label>View work items
      <select value={viewType} onChange={(event) => { setViewType(event.target.value); setMode('cards'); setReview(false); }}>
        <option value="">{project ? 'Child items' : 'Projects'}</option>
        {cardViews.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
      </select>
    </label>
    {error ? <p className="message" role="alert">{error}</p> : null}
    {!project && !viewType ? <div className="projectCards">{projects.map((entry) => {
      const records = items.filter((record) => record.project?.id === entry.id);
      return <article className="projectCard" key={entry.id} onClick={(event) => { if (!(event.target as HTMLElement).closest('button,a,input,select,textarea,summary')) navigate(String(entry.id)); }}><div className="cardDetailTopline"><button type="button" className="drillTitle" onClick={() => navigate(String(entry.id))}>{entry.name}</button><CardViewButton label={entry.name} target={{ kind: 'project', id: entry.id }} /></div><RichContent compact value={entry.description ?? ''} /><span>{records.filter((record) => workType(record) === 'Epic' && !audit.get(record.id)).length} epics</span><span>{records.filter((record) => audit.get(record.id)).length} need organization</span><ProjectApiLinks projectId={entry.id} /></article>;
    })}</div> : <>
      <div className="workToolbar">
        <h3>{selected ? `${workType(selected)} #${selected.id}: ${selected.summary}` : project?.name ?? 'All projects'}</h3>
        <div className="rowActions">
          {project ? <div className="segmented" role="group" aria-label="Hierarchy view"><button type="button" aria-pressed={mode === 'cards'} onClick={() => setMode('cards')}>Cards</button><button type="button" aria-pressed={mode === 'tree'} onClick={() => { setMode('tree'); setViewType(''); setReview(false); }}>Tree</button></div> : null}
          {project && nextType && !missingItem && (!selected || !audit.get(selected.id)) ? <button type="button" onClick={() => onCreate(nextType, project, selected)}>New {nextType === 'User Story' ? 'Story' : nextType}</button> : null}
          {selected ? <button type="button" className="ghostButton" onClick={() => onEdit(selected)}>Edit Item</button> : null}
        </div>
      </div>
      {missingItem ? <p role="alert">This work item is unavailable in this project.</p> : <>
        {selected && audit.get(selected.id) ? <p className="hierarchyWarning">Needs organization: {audit.get(selected.id)}</p> : null}
        {selected && !viewType ? <details className="workDetails" key={selected.id} open={workType(selected) === 'Bug' || undefined}><summary>Item description</summary><RichContent value={selected.description || 'No description recorded.'} /></details> : null}
        {mode === 'tree' ? <HierarchyTree items={projectItems} matchingIds={new Set(projectItems.map((entry) => entry.id))} onEdit={(entry) => navigate(projectId, entry.id)} onChange={onChange} /> : <>
          <div className="workToolbar"><h3>{review ? 'Needs organization' : viewLabel ?? (nextType ? `${nextType === 'User Story' ? 'Stories' : `${nextType}s`}` : 'Bug details')}</h3><div className="rowActions"><button type="button" className="ghostButton" aria-pressed={compact} onClick={() => { setCompact(!compact); setCollapsed(new Set()); }}>{compact ? 'Expand Cards' : 'Compact Cards'}</button><button type="button" className="ghostButton" aria-pressed={review} onClick={() => setReview(!review)}>Needs organization ({invalid.length})</button></div></div>
          {selected && workType(selected) === 'Bug' && !review && !viewType ? <p className="emptyState">Task #{parentId(selected)} · {selected.status?.name ?? 'Unspecified status'}</p> : null}
          <div className="drillCards">{visibleCards.map((entry) => {
            const isCollapsed = collapsed.has(entry.id) ? !compact : compact;
            const children = scopedItems.filter((child) => parentId(child) === entry.id && !audit.get(child.id));
            const entryProjectId = String(entry.project?.id ?? projectId);
            return <article key={entry.id} data-drill-item={entry.id} className={`drillCard ${isCollapsed ? 'compactDrillCard' : ''}`} draggable onClick={(event) => { if (!(event.target as HTMLElement).closest('button,a,input,select,textarea,summary')) navigate(entryProjectId, entry.id); }} onDragStart={(event) => startDrag(event, entry.id)} onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-sirius-work-item')) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void drop(draggedId(event), entry); }}>
              <div className="rowActions"><span className={`typeBadge type-${workType(entry).replace(/ /g, '-')}`}>{workType(entry)}</span><span>#{entry.id}</span><button type="button" className="iconButton" aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} drill card #${entry.id}`} aria-expanded={!isCollapsed} onClick={() => toggle(entry.id)}>{isCollapsed ? '+' : '-'}</button><CardViewButton label={`${workType(entry)} #${entry.id}: ${entry.summary}`} target={{ kind: 'item', id: entry.id }} /></div>
              <button type="button" className="drillTitle" onClick={() => navigate(entryProjectId, entry.id)}>{entry.summary}</button>
              {!project ? <span>{entry.project?.name}</span> : null}
              {!isCollapsed ? <><span>{entry.status?.name.replace(/_/g, ' ')} · {children.length} children</span><span>Assigned to: {entry.handler?.name || 'Unassigned'}</span>{audit.get(entry.id) ? <p className="hierarchyWarning">{audit.get(entry.id)}</p> : null}<button type="button" className="ghostButton" onClick={() => onEdit(entry)}>{audit.get(entry.id) ? 'Organize Item' : 'Edit Item'}</button></> : null}
            </article>;
          })}</div>
          {!review && visibleCards.length === 0 && (viewLabel || nextType) ? <p className="emptyState">No {viewLabel ? viewLabel.toLowerCase() : nextType === 'User Story' ? 'stories' : `${nextType.toLowerCase()}s`} recorded here.</p> : null}
        </>}
      </>}
    </>}
  </section>;
}
