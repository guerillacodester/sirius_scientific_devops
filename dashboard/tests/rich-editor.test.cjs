const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
    { exports, URL, Response, Request, Buffer, Uint8Array, process, require(name) { if (name in imports) return imports[name]; if (name.startsWith('node:')) return require(name); throw Error(`Unexpected import ${name}`); } });
  return exports;
}
const modules = Promise.all([import('react-markdown'), import('remark-gfm'), import('lowlight')]).then(([markdown, gfm, lowlight]) => load('app/rich-content.tsx', { react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-markdown': { __esModule: true, default: markdown.default }, 'remark-gfm': { __esModule: true, default: gfm.default }, lowlight }));
test('rich content renders formatting, tables and highlighted code without executing HTML', async () => {
  const { RichContent } = await modules;
  const value = '# Heading\n\n**Bold** and *italic* and ~~removed~~\n\n- One\n- Two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```javascript\nconst x = "<script>";\n```\n\n<script>alert(1)</script>';
  const html = renderToStaticMarkup(React.createElement(RichContent, { value }));
  for (const tag of ['<h1>', '<strong>', '<em>', '<del>', '<ul>', '<table>', '<pre>']) assert.ok(html.includes(tag), tag);
  assert.ok(html.includes('hljs-keyword')); assert.ok(!html.includes('<script>'));
});
test('renderer blocks executable links, data URLs and remote tracking images', async () => {
  const { richUrl, RichContent } = await modules;
  for (const url of ['javascript:alert(1)', 'data:text/html,abc', 'vbscript:bad']) assert.equal(richUrl(url), '');
  assert.equal(richUrl('https://example.test/pixel.png', true), '');
  const local = 'http://127.0.0.1:8878/api/editor-images/1/12345678-1234-1234-1234-123456789abc';
  assert.equal(richUrl(local, true), local);
  const html = renderToStaticMarkup(React.createElement(RichContent, { value: `![Screenshot](${local})\n\n![Blocked](https://example.test/pixel.png)` }));
  assert.ok(html.includes('alt="Screenshot"')); assert.ok(!html.includes('src="https://example.test'));
});
test('Markdown round-trip preserves basic formatting, code, tables and image links', async () => {
  const { MarkdownManager } = require('@tiptap/markdown');
  const StarterKit = require('@tiptap/starter-kit').default;
  const Image = require('@tiptap/extension-image').default;
  const { TableKit } = require('@tiptap/extension-table');
  const manager = new MarkdownManager({ extensions: [StarterKit, Image, TableKit], markedOptions: { gfm: true } });
  const value = '# Heading\n\n**Bold** *italic*\n\n```javascript\nconst a = 1;\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n![Screen](http://127.0.0.1:8878/api/editor-images/draft/12345678-1234-1234-1234-123456789abc)';
  const output = manager.serialize(manager.parse(value));
  for (const part of ['# Heading', '**Bold**', '*italic*', '```javascript', 'const a = 1;', '| A', '![Screen]']) assert.ok(output.includes(part), part);
});
test('image endpoint validates origin, MIME, size and decoded content; strips metadata and stores WebP', async () => {
  const sharp = require('sharp');
  const files = new Map();
  const route = load('app/api/editor-images/route.ts', {
    sharp, '../agent-access': { localOperatorRequest: (request) => request.headers.get('origin') === new URL(request.url).origin },
    '../mantis': { mantisFetch: async () => ({ projects: [{ id: 1 }] }) },
    'node:fs/promises': { mkdir: async () => {}, writeFile: async (file, data) => files.set(file, data) },
  });
  const request = (body, type = 'image/png', origin = 'http://127.0.0.1:8878') => new Request('http://127.0.0.1:8878/api/editor-images?projectId=1', { method: 'POST', headers: { 'Content-Type': type, Origin: origin }, body });
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#33aa88' } }).png().toBuffer();
  assert.equal((await route.POST(request(png, 'image/png', 'https://foreign.test'))).status, 403);
  assert.equal((await route.POST(request('<svg/>', 'image/svg+xml'))).status, 415);
  assert.equal((await route.POST(request('not an image'))).status, 400);
  assert.equal((await route.POST(request(Buffer.alloc(8 * 1024 * 1024 + 1)))).status, 413);
  const response = await route.POST(request(png)); assert.equal(response.status, 201);
  assert.equal(files.size, 1);
  const metadata = await sharp([...files.values()][0]).metadata(); assert.equal(metadata.format, 'webp'); assert.equal(metadata.exif, undefined);
  assert.ok((await response.json()).url.includes('/api/editor-images/1/'));
});
