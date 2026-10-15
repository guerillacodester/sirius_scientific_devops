'use client';

import { createElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { common, createLowlight } from 'lowlight';

export const codeHighlight = createLowlight(common);
export function richUrl(value: string, image = false) {
  try {
    const url = new URL(value, 'http://localhost');
    if (image) return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /^\/api\/editor-images\/(draft|[1-9]\d*)\/[a-f0-9-]{36}$/.test(url.pathname) ? value : '';
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? value : '';
  } catch { return ''; }
}
function highlighted(node: { type: string; value?: string; tagName?: string; properties?: { className?: unknown }; children?: unknown[] }, key: number): ReactNode {
  if (node.type === 'text') return node.value;
  return createElement(node.tagName === 'span' ? 'span' : 'span', { key, className: Array.isArray(node.properties?.className) ? node.properties.className.join(' ') : undefined }, node.children?.map((child, index) => highlighted(child as typeof node, index)));
}
export function RichContent({ value, compact = false }: { value: string; compact?: boolean }) {
  return <div className={`richContent ${compact ? 'richContentCompact' : ''}`}><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={(url) => richUrl(url)} components={{
    a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
    img: ({ src, alt }) => typeof src === 'string' && richUrl(src, true) ? <img src={src} alt={alt ?? ''} loading="lazy" /> : <span>{alt || 'Image unavailable'}</span>,
    code: ({ children, className }) => {
      const language = /language-([\w+-]+)/.exec(className ?? '')?.[1];
      const text = String(children);
      return <code className={className}>{language && codeHighlight.registered(language) ? codeHighlight.highlight(language, text).children.map((child, index) => highlighted(child, index)) : children}</code>;
    },
  }}>{value}</ReactMarkdown></div>;
}
