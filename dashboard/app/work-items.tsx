'use client';

import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { buildHierarchy, filterHierarchy, parentId, reorderItems, validateParent, workField, workType, type WorkItem, type WorkNode } from './hierarchy';
import { CardViewButton } from './card-details';

const statuses = ['new', 'assigned', 'in_progress', 'code_review', 'testing', 'resolved', 'closed'];
const dragType = 'application/x-sirius-work-item';
export function startDrag(event: DragEvent, id: number) {
  event.dataTransfer.setData(dragType, String(id));
  event.dataTransfer.effectAllowed = 'move';
}
export function draggedId(event: DragEvent) { return Number(event.dataTransfer.getData(dragType)); }

type WorkProps = {
  items: WorkItem[];
  onEdit: (item: WorkItem) => void;
  onOpen?: (item: WorkItem) => void;
  onChange: (id: number, change: { status?: string; parentId?: string }) => Promise<boolean>;
  onDelete?: (id: number) => void;
};

export function WorkBoard({ items, onEdit, onOpen, onChange, onDelete }: WorkProps) {
  const [compact, setCompact] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [order, setOrder] = useState<number[]>([]);
  const [pending, setPending] = useState(false);
  const [dropTarget, setDropTarget] = useState('');
  useEffect(() => {
    try {
      setCompact(localStorage.getItem('sirius-compact-cards') === 'true');
      const savedOrder = JSON.parse(localStorage.getItem('sirius-card-order') ?? '[]');
      if (Array.isArray(savedOrder)) setOrder(savedOrder.filter((id) => Number.isSafeInteger(id)));
      const savedCollapsed = JSON.parse(localStorage.getItem('sirius-collapsed-cards') ?? '{}');
      if (savedCollapsed && typeof savedCollapsed === 'object' && !Array.isArray(savedCollapsed)) setCollapsed(savedCollapsed);
    } catch { /* Ignore damaged local display preferences. */ }
  }, []);
  function savePreference(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Display still works without storage. */ }
  }
  function setDensity(value: boolean) {
    setCompact(value); setCollapsed({});
    savePreference('sirius-compact-cards', value); savePreference('sirius-collapsed-cards', {});
  }
  function toggleItem(id: number) {
    const next = { ...collapsed, [id]: !(collapsed[id] ?? compact) };
    setCollapsed(next); savePreference('sirius-collapsed-cards', next);
  }
  async function move(id: number, status: string, before?: number) {
    const item = items.find((entry) => entry.id === id);
    if (pending || !item || id === before) return;
    setPending(true);
    try {
      if (item.status?.name !== status && !await onChange(id, { status })) return;
      const next = reorderItems([...order, ...items.map((entry) => entry.id).filter((entry) => !order.includes(entry))], id, before);
      setOrder(next); savePreference('sirius-card-order', next);
    } finally { setPending(false); setDropTarget(''); }
  }
  function allowDrop(event: DragEvent, target: string) {
    if (pending || !Array.from(event.dataTransfer.types).includes(dragType)) return;
    event.preventDefault(); event.stopPropagation(); setDropTarget(target);
  }
  return <>
    <div className="workToolbar">
      <div className="segmented" role="group" aria-label="Card density">
        <button type="button" aria-pressed={!compact} onClick={() => setDensity(false)}>Cards</button>
        <button type="button" aria-pressed={compact} onClick={() => setDensity(true)}>Compact</button>
      </div>
      <span role="status">{pending ? 'Saving move...' : `${items.length} items`}</span>
    </div>
    <section className="board" aria-label="Kanban board" aria-busy={pending}>
      {statuses.map((status) => {
        const columnItems = items.filter((item) => item.status?.name === status).sort((a, b) => {
          const aIndex = order.indexOf(a.id); const bIndex = order.indexOf(b.id);
          return (aIndex < 0 ? order.length : aIndex) - (bIndex < 0 ? order.length : bIndex);
        });
        return <div className={`column ${dropTarget === status ? 'dropTarget' : ''}`} key={status}
          onDragOver={(event) => allowDrop(event, status)} onDragLeave={() => setDropTarget('')}
          onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void move(draggedId(event), status); }}>
          <h2><span>{status.replace(/_/g, ' ')}</span><strong>{columnItems.length}</strong></h2>
          <div className="issueList">{columnItems.map((item) => {
            const isCompact = collapsed[item.id] ?? compact;
            return <article key={item.id} data-work-item={item.id} className={`issue ${isCompact ? 'compactIssue' : ''} ${dropTarget === String(item.id) ? 'dropTarget' : ''}`}
              onClick={(event) => { if (!(event.target as HTMLElement).closest('button,a,input,select,textarea,summary,details')) (onOpen ?? onEdit)(item); }}
              draggable={!pending} onDragStart={(event) => startDrag(event, item.id)} onDragEnd={() => setDropTarget('')}
              onDragOver={(event) => allowDrop(event, String(item.id))}
              onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void move(draggedId(event), status, item.id); }}>
              <div className="issueTopline">
                <span className="dragGrip" title="Drag item" aria-hidden="true">&#8942;</span>
                <button type="button" className="iconButton" aria-label={`${isCompact ? 'Expand' : 'Collapse'} item #${item.id}`} aria-expanded={!isCompact} title={isCompact ? 'Expand card' : 'Collapse card'} onClick={() => toggleItem(item.id)}>{isCompact ? '+' : '-'}</button>
                <a href={`http://127.0.0.1:8877/view.php?id=${item.id}`} target="_blank" rel="noreferrer">#{item.id}</a>
                <span className={`typeBadge type-${workType(item).replace(/ /g, '-')}`}>{workType(item)}</span>
                <CardViewButton label={`${workType(item)} #${item.id}: ${item.summary}`} target={{ kind: 'item', id: item.id }} />
              </div>
              <button type="button" className="itemTitle" title={item.summary} onClick={() => (onOpen ?? onEdit)(item)}>{item.summary}</button>
              {!isCompact ? <dl><div><dt>Project</dt><dd>{item.project?.name ?? '-'}</dd></div><div><dt>Assigned to</dt><dd>{item.handler?.name || 'Unassigned'}</dd></div><div><dt>Sprint</dt><dd>{workField(item, 'Sprint') || '-'}</dd></div><div><dt>Parent</dt><dd>{parentId(item) ? `#${parentId(item)}` : '-'}</dd></div></dl> : null}
              <details className="itemActions"><summary>Actions</summary><div className="rowActions">
                <button type="button" className="ghostButton" onClick={() => onEdit(item)}>Edit</button>
                <label>Move to<select disabled={pending} value={status} onChange={(event) => void move(item.id, event.target.value)}>{statuses.map((value) => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}</select></label>
                <button type="button" className="iconButton" disabled={pending || columnItems[0]?.id === item.id} title="Move up" aria-label={`Move item #${item.id} up`} onClick={() => void move(item.id, status, columnItems[columnItems.indexOf(item) - 1]?.id)}>&#8593;</button>
                <button type="button" className="iconButton" disabled={pending || columnItems[columnItems.length - 1]?.id === item.id} title="Move down" aria-label={`Move item #${item.id} down`} onClick={() => void move(item.id, status, columnItems[columnItems.indexOf(item) + 2]?.id)}>&#8595;</button>
                {onDelete ? <button type="button" className="ghostButton" disabled={pending} onClick={() => onDelete(item.id)}>Delete</button> : null}
              </div></details>
            </article>;
          })}</div>
        </div>;
      })}
    </section>
  </>;
}

export function HierarchyTree({ items, matchingIds, onEdit, onChange }: WorkProps & { matchingIds: Set<number> }) {
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [target, setTarget] = useState<number | 'root' | null>(null);
  const nodes = useMemo(() => filterHierarchy(buildHierarchy(items), matchingIds), [items, matchingIds]);
  function toggle(id: number) { setClosed((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  async function reparent(id: number, to: number | null) {
    const child = items.find((item) => item.id === id);
    if (!child || pending) return;
    try {
      validateParent(child, to, items);
      setPending(true); setMessage('');
      if (await onChange(id, { parentId: to === null ? '' : String(to) })) {
        setClosed((current) => { const next = new Set(current); if (to !== null) next.delete(to); return next; });
      }
    } catch (error) { setMessage(String(error)); }
    finally { setPending(false); setTarget(null); }
  }
  function renderNode(node: WorkNode, level: number): React.ReactNode {
    const expanded = !closed.has(node.item.id);
    return <li key={node.item.id} role="treeitem" aria-label={`#${node.item.id} ${node.item.summary}`} aria-level={level} aria-expanded={node.children.length ? expanded : undefined} tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const rows = Array.from(event.currentTarget.closest('[role=tree]')!.querySelectorAll<HTMLElement>('[role=treeitem]'));
        const index = rows.indexOf(event.currentTarget);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          rows[event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
        } else if (event.key === 'ArrowRight') {
          event.preventDefault(); if (node.children.length && !expanded) toggle(node.item.id); else event.currentTarget.querySelector<HTMLElement>('[role=group] > [role=treeitem]')?.focus();
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault(); if (node.children.length && expanded) toggle(node.item.id); else event.currentTarget.parentElement?.closest<HTMLElement>('[role=treeitem]')?.focus();
        } else if (event.key === 'Enter') { event.preventDefault(); onEdit(node.item); }
      }}>
      <div className={`treeRow ${target === node.item.id ? 'dropTarget' : ''}`} draggable={!pending} onDragStart={(event) => { event.stopPropagation(); startDrag(event, node.item.id); }} onDragEnd={() => setTarget(null)}
        onDragOver={(event) => { if (!pending && Array.from(event.dataTransfer.types).includes(dragType)) { event.preventDefault(); event.stopPropagation(); setTarget(node.item.id); } }}
        onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void reparent(draggedId(event), node.item.id); }}>
        {node.children.length ? <button type="button" className="iconButton" aria-label={`${expanded ? 'Collapse' : 'Expand'} branch #${node.item.id}`} aria-expanded={expanded} onClick={() => toggle(node.item.id)}>{expanded ? '-' : '+'}</button> : <span className="treeSpacer" />}
        <span className={`typeBadge type-${workType(node.item).replace(/ /g, '-')}`}>{workType(node.item)}</span>
        <span className="treeId">#{node.item.id}</span>
        <button type="button" className="itemTitle" onClick={() => onEdit(node.item)}>{node.item.summary}</button>
        <span className="treeStatus">{node.item.status?.name.replace(/_/g, ' ')}</span>
      </div>
      {node.warning ? <p className="hierarchyWarning" role="status">#{node.item.id}: {node.warning}</p> : null}
      {expanded && node.children.length ? <ul role="group">{node.children.map((child) => renderNode(child, level + 1))}</ul> : null}
    </li>;
  }
  const projects = [...new Set(nodes.map((node) => node.item.project?.name ?? 'Unassigned'))];
  return <>
    <div className="workToolbar"><div className="rowActions"><button type="button" className="ghostButton" onClick={() => setClosed(new Set())}>Expand All</button><button type="button" className="ghostButton" onClick={() => setClosed(new Set(items.map((item) => item.id)))}>Collapse All</button></div><span role="status">{pending ? 'Saving parent...' : `${items.length} items`}</span></div>
    {message ? <p className="message" role="alert">{message}</p> : null}
    <div className={`rootDrop ${target === 'root' ? 'dropTarget' : ''}`} onDragOver={(event) => { if (!pending && Array.from(event.dataTransfer.types).includes(dragType)) { event.preventDefault(); setTarget('root'); } }} onDrop={(event) => { event.preventDefault(); void reparent(draggedId(event), null); }}>Project epics</div>
    {projects.map((project) => <section className="projectTree" key={project}><h3>{project}</h3><ul role="tree" aria-label={`${project} hierarchy`}>{nodes.filter((node) => !node.warning && (node.item.project?.name ?? 'Unassigned') === project).map((node) => renderNode(node, 1))}</ul>{nodes.some((node) => node.warning && (node.item.project?.name ?? 'Unassigned') === project) ? <><h3>Needs organization</h3><ul role="tree" aria-label={`${project} needs organization`}>{nodes.filter((node) => node.warning && (node.item.project?.name ?? 'Unassigned') === project).map((node) => renderNode(node, 1))}</ul></> : null}</section>)}
    {nodes.length === 0 ? <p className="emptyState">No work items match the current filters.</p> : null}
  </>;
}
