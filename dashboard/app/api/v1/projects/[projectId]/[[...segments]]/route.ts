import { projectAgentRequest } from '../../../../agent-project';

async function handle(request: Request, context: { params: Promise<{ projectId: string; segments?: string[] }> }) {
  const { projectId, segments } = await context.params;
  return projectAgentRequest(request, projectId, segments);
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
