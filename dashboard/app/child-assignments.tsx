'use client';

import { useEffect, useState } from 'react';
import { parentId, validateParent, workType, type WorkItem } from './hierarchy';

export function eligibleChildren(item: WorkItem, items: WorkItem[]) {
  return items.filter((child) => {
    if (parentId(child) === item.id) return false;
    try { validateParent(child, item.id, items); return true; } catch { return false; }
  });
}

export function ChildAssignments({ item, items, onChange, onOpen, onCreate }: {
  item: WorkItem; items: WorkItem[];
  onChange: (id: number, change: { parentId: string }) => Promise<boolean>;
  onOpen: (projectId?: string, itemId?: number) => void;
  onCreate: (type: string, project: { id: number; name: string }, parent: WorkItem) => void;
}) {
  const [childId, setChildId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setChildId(''); }, [item.id]);
  const children = items.filter((child) => child.project?.id === item.project?.id && parentId(child) === item.id);
  const candidates = eligibleChildren(item, items);
  const nextType = ({ Epic: 'User Story', 'User Story': 'Feature', Feature: 'Task', Task: 'Bug' } as Record<string, string>)[workType(item)];
  async function link() {
    const child = candidates.find((entry) => String(entry.id) === childId);
    if (!child || busy) return;
    if (parentId(child) && !window.confirm(`Move #${child.id} from parent #${parentId(child)} to #${item.id}?`)) return;
    setBusy(true);
    try { if (await onChange(child.id, { parentId: String(item.id) })) setChildId(''); }
    finally { setBusy(false); }
  }
  return <fieldset className="childAssignments" disabled={busy}>
    <legend>Children of #{item.id}</legend>
    <ul>{children.map((child) => <li key={child.id}><button type="button" className="ghostButton" onClick={() => onOpen(String(child.project?.id), child.id)}>#{child.id} {workType(child)}: {child.summary}</button></li>)}</ul>
    {nextType ? <div className="rowActions">
      <label>Existing child<select value={childId} onChange={(event) => setChildId(event.target.value)}><option value="">Select child to link</option>{candidates.map((child) => <option key={child.id} value={child.id}>#{child.id} {workType(child)}: {child.summary}{parentId(child) ? ` (move from #${parentId(child)})` : ''}</option>)}</select></label>
      <button type="button" disabled={!candidates.some((entry) => String(entry.id) === childId)} onClick={() => void link()}>{busy ? 'Linking...' : 'Link Child'}</button>
      {item.project ? <button type="button" className="ghostButton" onClick={() => onCreate(nextType, item.project!, item)}>New {nextType === 'User Story' ? 'Story' : nextType}</button> : null}
    </div> : null}
    {!children.length && !nextType ? <p className="emptyState">No child level for this item type.</p> : null}
  </fieldset>;
}
