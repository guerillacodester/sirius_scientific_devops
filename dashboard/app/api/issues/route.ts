import { NextRequest, NextResponse } from 'next/server';
import { mantisFetch, publicError } from '../mantis';
import { issuePayload } from './payload';
import { allProjectIssues, validateHierarchyInput } from './hierarchy';
import { validateIssueAssignee } from '../project-users';
import { projectBridge } from '../project-bridge';

export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.searchParams;
    return NextResponse.json({ issues: await allProjectIssues(search.get('project_id') ?? undefined) });
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = await request.json();
    await validateHierarchyInput(input);
    await validateIssueAssignee(input);
    const payload = issuePayload(input);
    const projects = await mantisFetch<{ projects: Array<{ id: number; name: string }> }>('/api/rest/projects');
    const project = projects.projects.find((entry) => entry.name === input.project);
    if (!project) throw new Error('Project not found.');
    await projectBridge({ operation: 'configure', projectId: project.id });
    const data = await mantisFetch('/api/rest/issues', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 400 });
  }
}
