import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function GET(_request: Request, context: { params: Promise<{ scope: string; id: string }> }) {
  const { scope, id } = await context.params;
  if (!/^(draft|[1-9]\d*)$/.test(scope) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) return new Response(null, { status: 404 });
  try {
    const image = await readFile(path.resolve(process.cwd(), '..', 'data', 'rich-images', scope, `${id}.webp`));
    // Random URLs are local image capabilities; the trusted-local dashboard is not a public host.
    return new Response(image, { headers: { 'Content-Type': 'image/webp', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Security-Policy': "default-src 'none'", 'Referrer-Policy': 'no-referrer' } });
  } catch { return new Response(null, { status: 404 }); }
}
