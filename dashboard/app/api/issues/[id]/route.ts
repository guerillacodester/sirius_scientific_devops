import { NextRequest, NextResponse } from 'next/server';
import { mantisFetch, publicError } from '../../mantis';
import { issuePayload } from '../payload';
import { allProjectIssues, validateHierarchyInput } from '../hierarchy';
import { parentId } from '../../../hierarchy';
import { validateIssueAssignee } from '../../project-users';
import { saveIssueUpdate } from '../update';

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
      return NextResponse.json({ error: 'Invalid work item ID.' }, { status: 400 });
    }
    const input = await request.json();
    const current = await validateHierarchyInput(input, Number(id));
    await validateIssueAssignee(input, Number(id));
    if (input.parentId === '' && current && parentId(current) === null) delete input.parentId;
    const body = issuePayload(input, true);
    const data = await saveIssueUpdate(Number(id), body, current);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return NextResponse.json({ error: 'Invalid work item ID.' }, { status: 400 });
    const records = await allProjectIssues();
    if (records.some((item) => parentId(item) === Number(id))) {
      return NextResponse.json({ error: 'Move or remove child items before deleting their parent.' }, { status: 409 });
    }
    const data = await mantisFetch(`/api/rest/issues/${id}`, {
      method: 'DELETE',
    });
    return NextResponse.json(data ?? { removed: { id } });
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 });
  }
}
