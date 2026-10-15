'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Bold, Italic, Strikethrough, Code, Braces, List, ListOrdered, Quote, Link, Unlink, ImagePlus, Table, Undo2, Redo2, Maximize2, Minimize2, Eraser, Minus, Plus, Trash2, X, type LucideIcon } from 'lucide-react';
import { codeHighlight, richUrl } from './rich-content';

type Props = { label: string; value: string; onChange: (value: string) => void; projectId?: number; readOnly?: boolean; onBusyChange?: (busy: boolean) => void };
const SafeImage = Image.extend({ parseHTML() { return [{ tag: 'img[src]', getAttrs: (element) => richUrl((element as HTMLElement).getAttribute('src') ?? '', true) ? null : false }]; } });

export function RichEditor({ label, value, onChange, projectId, readOnly = false, onBusyChange }: Props) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const latest = useRef({ onChange, onBusyChange, projectId, readOnly });
  latest.current = { onChange, onBusyChange, projectId, readOnly };
  const emitted = useRef(value);
  const uploadingRef = useRef(false);
  const alive = useRef(true);
  const abort = useRef<AbortController | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ codeBlock: false, underline: false, link: { openOnClick: false } }), Markdown.configure({ markedOptions: { gfm: true } }), SafeImage, TableKit.configure({ table: { resizable: false } }), CodeBlockLowlight.configure({ lowlight: codeHighlight })],
    content: value, contentType: 'markdown', editable: !readOnly,
    editorProps: {
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': label, spellcheck: 'true' },
      handlePaste: (_view, event) => {
        const images = Array.from(event.clipboardData?.files ?? []).filter((entry) => entry.type.startsWith('image/'));
        if (!images.length) return false;
        event.preventDefault(); void upload(images); return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const images = Array.from(event.dataTransfer?.files ?? []).filter((entry) => entry.type.startsWith('image/'));
        if (moved || !images.length) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        void upload(images, at?.pos); return true;
      },
    },
    onUpdate: ({ editor }) => { const markdown = editor.isEmpty ? '' : editor.getMarkdown(); emitted.current = markdown; latest.current.onChange(markdown); },
  });
  const state = useEditorState({ editor, selector: ({ editor }) => editor ? { bold: editor.isActive('bold'), italic: editor.isActive('italic'), strike: editor.isActive('strike'), code: editor.isActive('code'), block: editor.isActive('codeBlock'), quote: editor.isActive('blockquote'), bullets: editor.isActive('bulletList'), ordered: editor.isActive('orderedList'), table: editor.isActive('table'), link: editor.isActive('link'), image: editor.isActive('image'), heading: [1, 2, 3].find((level) => editor.isActive('heading', { level })) ?? 0, language: editor.getAttributes('codeBlock').language ?? '', undo: editor.can().undo(), redo: editor.can().redo() } : null });
  useEffect(() => {
    if (editor && value !== emitted.current) { emitted.current = value; editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false }); }
  }, [value, editor]);
  useEffect(() => { editor?.setEditable(!readOnly && !uploading); }, [editor, readOnly, uploading]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; abort.current?.abort(); if (uploadingRef.current) latest.current.onBusyChange?.(false); };
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setExpanded(false); event.stopPropagation(); } };
    document.addEventListener('keydown', escape, true);
    return () => document.removeEventListener('keydown', escape, true);
  }, [expanded]);

  async function upload(files: File[], position?: number) {
    if (!editor || editor.isDestroyed || uploadingRef.current || latest.current.readOnly) return;
    uploadingRef.current = true; setUploading(true); setError(''); latest.current.onBusyChange?.(true);
    const controller = new AbortController(); abort.current = controller;
    let at = position ?? editor.state.selection.from;
    try {
      for (const image of files) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.type) || image.size > 8 * 1024 * 1024) throw new Error('Choose PNG, JPEG or WebP images up to 8 MB.');
        const response = await fetch(`/api/editor-images${latest.current.projectId ? `?projectId=${latest.current.projectId}` : ''}`, { method: 'POST', headers: { 'Content-Type': image.type }, body: image, signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'Image upload failed.');
        if (!alive.current || editor.isDestroyed) return;
        editor.chain().insertContentAt(Math.min(at, editor.state.doc.content.size), { type: 'image', attrs: { src: data.url, alt: image.name.replace(/\.[^.]+$/, '') } }).run();
        at = editor.state.selection.to;
      }
    } catch (failure) { if (alive.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Image upload failed.'); }
    finally { uploadingRef.current = false; if (alive.current) setUploading(false); latest.current.onBusyChange?.(false); }
  }
  function tool(name: string, Icon: LucideIcon, run: () => void, active?: boolean, disabled = false) {
    return <button type="button" className="richTool" title={name} aria-label={name} aria-pressed={active} disabled={!editor || readOnly || uploading || disabled} onMouseDown={(event) => event.preventDefault()} onClick={run}><Icon size={16} strokeWidth={1.8} /></button>;
  }
  return <div className={`richEditor ${expanded ? 'richEditorExpanded' : ''}`} data-readonly={readOnly} onClick={(event) => event.stopPropagation()}>
    <div className="richEditorHeading"><span id={`${id}-label`}>{label}</span><button type="button" className="richTool" title={expanded ? 'Exit fullscreen' : 'Fullscreen editor'} aria-label={expanded ? 'Exit fullscreen' : 'Fullscreen editor'} aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button></div>
    <div className="richToolbar" role="toolbar" aria-label={`${label} formatting`}>
      <select aria-label="Paragraph style" title="Paragraph style" value={state?.heading ?? 0} disabled={!editor || readOnly || uploading} onChange={(event) => { const level = Number(event.target.value); if (level) editor?.chain().focus().setHeading({ level: level as 1 | 2 | 3 }).run(); else editor?.chain().focus().setParagraph().run(); }}><option value={0}>Paragraph</option><option value={1}>Heading 1</option><option value={2}>Heading 2</option><option value={3}>Heading 3</option></select>
      <div className="richToolGroup">{tool('Bold', Bold, () => { editor?.chain().focus().toggleBold().run(); }, state?.bold)}{tool('Italic', Italic, () => { editor?.chain().focus().toggleItalic().run(); }, state?.italic)}{tool('Strikethrough', Strikethrough, () => { editor?.chain().focus().toggleStrike().run(); }, state?.strike)}{tool('Inline code', Code, () => { editor?.chain().focus().toggleCode().run(); }, state?.code)}</div>
      <div className="richToolGroup">{tool('Bullet list', List, () => { editor?.chain().focus().toggleBulletList().run(); }, state?.bullets)}{tool('Numbered list', ListOrdered, () => { editor?.chain().focus().toggleOrderedList().run(); }, state?.ordered)}{tool('Quote', Quote, () => { editor?.chain().focus().toggleBlockquote().run(); }, state?.quote)}{tool('Code block', Braces, () => { editor?.chain().focus().toggleCodeBlock().run(); }, state?.block)}</div>
      <div className="richToolGroup">{tool('Insert or edit link', Link, () => { setLink(editor?.getAttributes('link').href ?? ''); setLinkOpen(!linkOpen); }, state?.link)}{tool('Insert image', ImagePlus, () => file.current?.click())}{tool('Insert table', Table, () => { editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); }, state?.table, state?.table)}{tool('Horizontal rule', Minus, () => { editor?.chain().focus().setHorizontalRule().run(); })}</div>
      <div className="richToolGroup">{tool('Clear formatting', Eraser, () => { editor?.chain().focus().unsetAllMarks().clearNodes().run(); })}{tool('Undo', Undo2, () => { editor?.chain().focus().undo().run(); }, undefined, !state?.undo)}{tool('Redo', Redo2, () => { editor?.chain().focus().redo().run(); }, undefined, !state?.redo)}</div>
    </div>
    {linkOpen ? <div className="richContextBar"><label>Link URL<input type="url" value={link} placeholder="https://" onChange={(event) => setLink(event.target.value)} /></label><button type="button" disabled={!richUrl(link) || !link.trim() || readOnly || uploading} onClick={() => { editor?.chain().focus().extendMarkRange('link').setLink({ href: richUrl(link) }).run(); setLinkOpen(false); }}>Apply</button>{tool('Remove link', Unlink, () => { editor?.chain().focus().extendMarkRange('link').unsetLink().run(); setLinkOpen(false); })}<button type="button" className="richTool" title="Close link editor" aria-label="Close link editor" onClick={() => setLinkOpen(false)}><X size={16} /></button></div> : null}
    {state?.block ? <div className="richContextBar"><label>Code language<select value={state.language} disabled={readOnly || uploading} onChange={(event) => editor?.chain().focus().updateAttributes('codeBlock', { language: event.target.value || null }).run()}><option value="">Plain text</option>{Array.from(new Set([...codeHighlight.listLanguages(), state.language])).filter(Boolean).sort().map((language) => <option key={language} value={language}>{language}</option>)}</select></label></div> : null}
    {state?.table ? <div className="richContextBar">{tool('Add row', Plus, () => { editor?.chain().focus().addRowAfter().run(); })}{tool('Delete row', Minus, () => { editor?.chain().focus().deleteRow().run(); })}<span className="richContextLabel">Rows</span>{tool('Add column', Plus, () => { editor?.chain().focus().addColumnAfter().run(); })}{tool('Delete column', Minus, () => { editor?.chain().focus().deleteColumn().run(); })}<span className="richContextLabel">Columns</span>{tool('Delete table', Trash2, () => { editor?.chain().focus().deleteTable().run(); })}</div> : null}
    {state?.image ? <div className="richContextBar"><label>Image description<input value={editor?.getAttributes('image').alt ?? ''} disabled={readOnly || uploading} onChange={(event) => editor?.commands.updateAttributes('image', { alt: event.target.value })} /></label>{tool('Delete image', Trash2, () => { editor?.chain().focus().deleteSelection().run(); })}</div> : null}
    <EditorContent editor={editor} className="richEditorSurface" aria-labelledby={`${id}-label`} />
    <input ref={file} className="richFileInput" type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label={`${label} image upload`} disabled={readOnly || uploading} onChange={(event) => { void upload(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    <footer className="richEditorFooter"><span role="status">{uploading ? 'Uploading image...' : readOnly ? 'Read only' : `${editor?.getText().length ?? value.length} characters`}</span><span>Markdown</span></footer>
    {error ? <p className="richEditorError" role="alert">{error}</p> : null}
  </div>;
}
