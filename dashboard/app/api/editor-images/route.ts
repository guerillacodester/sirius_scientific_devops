import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { localOperatorRequest } from '../agent-access';
import { mantisFetch } from '../mantis';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (!localOperatorRequest(request)) return Response.json({ error: 'Use the local dashboard to upload images.' }, { status: 403 });
  const project = new URL(request.url).searchParams.get('projectId');
  if (project !== null && (!/^[1-9]\d*$/.test(project) || !Number.isSafeInteger(Number(project)))) return Response.json({ error: 'Invalid project ID.' }, { status: 400 });
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(request.headers.get('content-type') ?? '')) return Response.json({ error: 'Use PNG, JPEG or WebP images.' }, { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: 'An image is required.' }, { status: 400 });
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8 * 1024 * 1024) { await reader.cancel(); return Response.json({ error: 'Images cannot exceed 8 MB.' }, { status: 413 }); }
      chunks.push(value);
    }
    if (project) {
      const data = await mantisFetch<{ projects: Array<{ id: number }> }>(`/api/rest/projects/${project}`);
      if (!data.projects?.some((entry) => entry.id === Number(project))) return Response.json({ error: 'Project not found.' }, { status: 404 });
    }
    const image = sharp(Buffer.concat(chunks), { limitInputPixels: 20000000, animated: false });
    const metadata = await image.metadata();
    if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '')) return Response.json({ error: 'Invalid image format.' }, { status: 415 });
    const bytes = await image.rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
    const scope = project ?? 'draft';
    const folder = path.resolve(process.cwd(), '..', 'data', 'rich-images', scope);
    await mkdir(folder, { recursive: true });
    const id = randomUUID();
    await writeFile(path.join(folder, `${id}.webp`), bytes, { flag: 'wx', mode: 0o600 });
    return Response.json({ url: `${new URL(request.url).origin}/api/editor-images/${scope}/${id}`, contentType: 'image/webp' }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Could not upload this image. Check its format, dimensions and local Mantis availability.' }, { status: 400 }); }
  finally { reader.releaseLock(); }
}
