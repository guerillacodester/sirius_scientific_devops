import { NextRequest, NextResponse } from 'next/server';
import { mantisFetch, publicError } from '../../mantis';

type Context = {
  params: Promise<{
    id: string;
  }>;
};

function projectPayload(input: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};
  if (typeof input.name === 'string') {
    payload.name = input.name.trim();
  }
  if (typeof input.description === 'string') {
    payload.description = input.description;
  }
  if (typeof input.enabled === 'boolean') {
    payload.enabled = input.enabled;
  }
  if (typeof input.status === 'string' && input.status.trim()) {
    payload.status = { name: input.status.trim() };
  }
  if (typeof input.view_state === 'string' && input.view_state.trim()) {
    payload.view_state = { name: input.view_state.trim() };
  }
  return payload;
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const data = await mantisFetch(`/api/rest/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(projectPayload(await request.json())),
    });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    await mantisFetch(`/api/rest/projects/${id}`, { method: 'DELETE' });
    return NextResponse.json({ removed: { id } });
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 });
  }
}
