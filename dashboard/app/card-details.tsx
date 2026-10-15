'use client';

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { parentId, requiredParentType, workType, type WorkItem, type WorkNode } from './hierarchy';
import { cardDetailTree } from './card-details-tree';
import { CardViewIcon } from './card-view-icon';
import { RichContent } from './rich-content';

type Project = {
  id: number; name: string; description?: string; enabled?: boolean;
  status?: { name?: string; label?: string }; view_state?: { name?: string; label?: string };
  categories?: Array<{ id: number; name: string }>;
};
type Repository = { project: string; repoName: string; provider: string; url: string; defaultBranch: string; localPath?: string; notes?: string };
type DetailItem = WorkItem & {
  category?: { name: string }; priority?: { name: string; label?: string }; severity?: { name: string; label?: string };
  reporter?: { name: string }; created_at?: string; updated_at?: string; steps_to_reproduce?: string; additional_information?: string;
};
export type CardDetailTarget =
  | { kind: 'project'; id: number }
  | { kind: 'item'; id: number }
  | { kind: 'repository'; project: string; repoName: string }
  | { kind: 'summary'; title: string; fields: Array<{ name: string; value: string | number }>; itemIds?: number[]; projectIds?: number[]; repositories?: Array<{ project: string; repoName: string }> };

const DetailsContext = createContext<((target: CardDetailTarget) => void) | null>(null);

export function CardViewButton({ target, label }: { target: CardDetailTarget; label: string }) {
  const open = useContext(DetailsContext);
  return <button type="button" className="iconButton cardViewButton" aria-label={`View details: ${label}`} title={`View details: ${label}`} aria-haspopup="dialog" disabled={!open} draggable={false}
    onPointerDown={(event) => event.stopPropagation()} onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => { event.stopPropagation(); open?.(target); }}><CardViewIcon /></button>;
}

export function CardDetailsProvider({ projects, items, repositories, children }: { projects: Project[]; items: WorkItem[]; repositories: Repository[]; children: ReactNode }) {
  const [target, setTarget] = useState<CardDetailTarget | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (target) {
      if (!element.open) element.showModal();
      element.scrollTop = 0;
      heading.current?.focus();
    } else if (element.open) element.close();
  }, [target]);

  const item: DetailItem | undefined = target?.kind === 'item' ? items.find((entry) => entry.id === target.id) : undefined;
  const project = target?.kind === 'project' ? projects.find((entry) => entry.id === target.id) : item ? projects.find((entry) => entry.id === item.project?.id) : target?.kind === 'repository' ? projects.find((entry) => entry.name === target.project) : undefined;
  const repository = target?.kind === 'repository' ? repositories.find((entry) => entry.project === target.project && entry.repoName === target.repoName) : undefined;
  const title = target?.kind === 'summary' ? target.title : target?.kind === 'project' ? project?.name ?? 'Project unavailable' : target?.kind === 'repository' ? repository?.repoName ?? 'Repository unavailable' : item ? `${workType(item)} #${item.id}: ${item.summary}` : 'Item unavailable';
  const parent = item && parentId(item) !== null ? items.find((entry) => entry.id === parentId(item) && entry.project?.id === item.project?.id) : undefined;
  const fields: Array<{ name: string; value: string | number }> = [];
  let description = '';
  if (target?.kind === 'project' && project) {
    description = project.description ?? '';
    fields.push({ name: 'Project ID', value: project.id }, { name: 'Status', value: project.status?.label ?? project.status?.name ?? 'Unspecified' }, { name: 'Visibility', value: project.view_state?.label ?? project.view_state?.name ?? 'Unspecified' }, { name: 'Enabled', value: project.enabled === undefined ? 'Unspecified' : project.enabled ? 'Yes' : 'No' }, { name: 'Categories', value: project.categories?.map((entry) => entry.name).join(', ') || 'None' });
  } else if (item) {
    description = item.description ?? '';
    fields.push({ name: 'Type', value: workType(item) }, { name: 'Status', value: item.status?.name.replace(/_/g, ' ') ?? 'Unspecified' }, { name: 'Assigned to', value: item.handler?.name || 'Unassigned' }, { name: 'Category', value: item.category?.name ?? 'Unspecified' }, { name: 'Priority', value: item.priority?.label ?? item.priority?.name ?? 'Unspecified' }, { name: 'Severity', value: item.severity?.label ?? item.severity?.name ?? 'Unspecified' });
    if (item.reporter) fields.push({ name: 'Reported by', value: item.reporter.name });
    if (item.created_at) fields.push({ name: 'Created', value: item.created_at });
    if (item.updated_at) fields.push({ name: 'Updated', value: item.updated_at });
    for (const field of item.custom_fields ?? []) if (field.field?.name && !['Work Item Type', 'Parent Issue'].includes(field.field.name)) fields.push({ name: field.field.name, value: field.value || 'Not recorded' });
  } else if (repository) {
    description = repository.notes ?? '';
    fields.push({ name: 'Provider', value: repository.provider }, { name: 'URL', value: repository.url }, { name: 'Default branch', value: repository.defaultBranch }, { name: 'Local path', value: repository.localPath || 'Not recorded' });
  } else if (target?.kind === 'summary') fields.push(...target.fields);

  function tree(nodes: WorkNode[]): ReactNode {
    return <ul className="cardDetailTree">{nodes.map((node) => {
      const link = <button type="button" className="detailItemLink" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setTarget({ kind: 'item', id: node.item.id }); }}><span className={`typeBadge type-${workType(node.item).replace(/ /g, '-')}`}>{workType(node.item)}</span><span>#{node.item.id} {node.item.summary}</span></button>;
      return <li key={node.item.id}>{node.children.length ? <details open><summary>{link}</summary>{tree(node.children)}</details> : link}{node.warning ? <p className="cardDetailWarning">{node.warning}</p> : null}</li>;
    })}</ul>;
  }
  function projectTree(entry: Project, matchingIds?: Set<number>) {
    return <section className="cardDetailProject" key={entry.id}><h4><button type="button" className="detailParentLink" onClick={() => setTarget({ kind: 'project', id: entry.id })}>{entry.name}</button></h4>{tree(cardDetailTree(items, entry.id, null, matchingIds))}</section>;
  }
  const descendants = item?.project ? cardDetailTree(items, item.project.id, item.id) : target?.kind === 'project' && project ? cardDetailTree(items, project.id) : [];
  const summaryIds = target?.kind === 'summary' && target.itemIds ? new Set(target.itemIds) : undefined;
  return <DetailsContext.Provider value={setTarget}>
    {children}
    <dialog ref={dialog} className="cardDetailsDialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); setTarget(null); }} onClose={() => setTarget(null)} onClick={(event) => { if (event.target === event.currentTarget) setTarget(null); }}>
      <div className="cardDetailsContent" key={target ? JSON.stringify(target) : 'closed'}>
        <header className="cardDetailsHeader"><h2 id={titleId} ref={heading} tabIndex={-1}>{title}</h2><button type="button" className="iconButton" aria-label="Close card details" title="Close card details" onClick={() => setTarget(null)}>&#215;</button></header>
        <nav className="cardDetailParent" aria-label="Parent item"><span>Parent:</span>{item && parentId(item) !== null ? parent ? <button type="button" className="detailParentLink" onClick={() => setTarget({ kind: 'item', id: parent.id })}>#{parent.id} {parent.summary}</button> : <span>#{parentId(item)} (unavailable)</span> : item && requiredParentType(workType(item)) !== null ? <span>Not linked</span> : project && target?.kind !== 'project' ? <button type="button" className="detailParentLink" onClick={() => setTarget({ kind: 'project', id: project.id })}>{project.name}</button> : <span>Workspace</span>}</nav>
        {item && project ? <div className="cardDetailParent"><span>Project:</span><button type="button" className="detailParentLink" onClick={() => setTarget({ kind: 'project', id: project.id })}>{project.name}</button></div> : null}
        <section className="cardOwnDetails" aria-label="Selected card details"><h3>Details</h3>{description ? <RichContent value={description} /> : target?.kind !== 'summary' ? <p className="emptyState">No description recorded.</p> : null}<dl>{fields.map((field, index) => <div key={`${field.name}-${index}`}><dt>{field.name}</dt><dd>{field.name === 'Relevant Logs' ? <RichContent value={String(field.value)} /> : field.value}</dd></div>)}</dl>{item?.steps_to_reproduce ? <><h4>Steps to reproduce</h4><RichContent value={item.steps_to_reproduce} /></> : null}{item?.additional_information ? <><h4>Additional information</h4><RichContent value={item.additional_information} /></> : null}</section>
        <section className="cardDetailDescendants" aria-label="Descendant hierarchy"><h3>Children</h3>
          {target?.kind === 'item' || target?.kind === 'project' ? descendants.length ? tree(descendants) : <p className="emptyState">No child items.</p> : null}
          {target?.kind === 'repository' ? <p className="emptyState">No child items.</p> : null}
          {target?.kind === 'summary' ? <>
            {target.projectIds ? projects.filter((entry) => target.projectIds!.includes(entry.id)).map((entry) => projectTree(entry)) : null}
            {summaryIds ? projects.filter((entry) => items.some((record) => record.project?.id === entry.id && summaryIds.has(record.id))).map((entry) => projectTree(entry, summaryIds)) : null}
            {target.repositories ? <ul className="cardDetailTree">{target.repositories.map((entry) => <li key={`${entry.project}:${entry.repoName}`}><button type="button" className="detailItemLink" onClick={() => setTarget({ kind: 'repository', project: entry.project, repoName: entry.repoName })}>{entry.project}: {entry.repoName}</button></li>)}</ul> : null}
            {!(target.projectIds?.length || target.itemIds?.length || target.repositories?.length) ? <p className="emptyState">No child items.</p> : null}
          </> : null}
        </section>
      </div>
    </dialog>
  </DetailsContext.Provider>;
}
