import { NextRequest, NextResponse } from 'next/server';
import { mantisFetch, publicError } from '../../../mantis';
import { readRegistry } from '../../../repos/store';
import { prepareTaskUpdate } from '../../../../task-update';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
      return NextResponse.json({ error: 'Invalid task ID.' }, { status: 400 });
    }
    const input = await request.json();
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return NextResponse.json({ error: 'Task update must be an object.' }, { status: 400 });
    }
    const data = await mantisFetch<{
      issues: Array<{ id: number; summary: string; project?: { name: string } }>;
    }>(`/api/rest/issues/${id}`);
    const task = data.issues?.find((issue) => issue.id === Number(id));
    if (!task) return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
    const registry = await readRegistry();
    let update;
    try {
      update = prepareTaskUpdate(task, registry.repositories, input);
    } catch (error) {
      return NextResponse.json({ error: publicError(error) }, { status: 400 });
    }
    const note = await mantisFetch(`/api/rest/issues/${id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ text: update.text, view_state: { name: 'private' } }),
    });
    return NextResponse.json({ note, commitMessage: update.commitMessage, repository: update.repository });
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 });
  }
}
