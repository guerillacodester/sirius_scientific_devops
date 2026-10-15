import { NextResponse } from 'next/server';
import { projectHandlers } from '../../../project-users';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return NextResponse.json({ error: 'Invalid project ID.' }, { status: 400 });
  try { return NextResponse.json({ users: await projectHandlers(Number(id)) }); }
  catch { return NextResponse.json({ error: 'Could not load project assignees.' }, { status: 502 }); }
}
