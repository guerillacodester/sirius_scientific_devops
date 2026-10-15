import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { mantisFetch, publicError } from '../mantis';

function projectPayload(input: Record<string, unknown>) {
  return {
    name: String(input.name ?? '').trim(),
    description: String(input.description ?? ''),
    status: { name: String(input.status ?? 'development') },
    view_state: { name: String(input.view_state ?? 'public') },
    enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
    inherit_global: true,
  };
}

export async function GET() {
  try {
    const data = await mantisFetch('/api/rest/projects');
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = projectPayload(await request.json());
    if (!payload.name) {
      return NextResponse.json({ error: 'Project name is required.' }, { status: 400 });
    }
    const data = await mantisFetch('/api/rest/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 });
  }
}
