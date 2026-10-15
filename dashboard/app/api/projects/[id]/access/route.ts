import { NextResponse } from 'next/server';
import { agentAccess, localOperatorRequest, type AgentRole } from '../../../agent-access';
import { mantisFetch } from '../../../mantis';

async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!localOperatorRequest(request)) return NextResponse.json({ error: 'Use the local dashboard to manage credentials. Agent credentials cannot manage access.' }, { status: 403 });
  const { id } = await context.params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return NextResponse.json({ error: 'Invalid project ID.' }, { status: 400 });
  try {
    const data = await mantisFetch<{ projects: Array<{ id: number }> }>(`/api/rest/projects/${id}`);
    if (!data.projects?.some((project) => project.id === Number(id))) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    if (request.method === 'GET') return NextResponse.json({ keys: await agentAccess.list(Number(id)) }, { headers: { 'Cache-Control': 'no-store' } });
    const input = await request.json();
    if (request.method === 'DELETE') {
      if (typeof input?.id !== 'string') return NextResponse.json({ error: 'Credential ID is required.' }, { status: 400 });
      const revoked = await agentAccess.revoke(Number(id), input.id);
      return NextResponse.json({ revoked }, { status: revoked ? 200 : 404 });
    }
    const result = await agentAccess.issue(Number(id), input?.name, input?.role as AgentRole, input?.days ?? 90);
    return NextResponse.json(result, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Could not manage project access. Check credential settings and local Mantis availability.' }, { status: 400 }); }
}
export { handle as GET, handle as POST, handle as DELETE };
