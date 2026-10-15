import { NextRequest, NextResponse } from 'next/server';
import { publicError } from '../../../mantis';
import { normalizeRepo, readRegistry, writeRegistry } from '../../store';

type Context = {
  params: Promise<{
    project: string;
    repoName: string;
  }>;
};

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const params = await context.params;
    const project = decodeURIComponent(params.project);
    const repoName = decodeURIComponent(params.repoName);
    const registry = await readRegistry();
    const index = registry.repositories.findIndex(
      (item) => item.project === project && item.repoName === repoName,
    );
    if (index < 0) {
      return NextResponse.json({ error: 'Repository not found.' }, { status: 404 });
    }

    const entry = normalizeRepo({ ...registry.repositories[index], ...(await request.json()) });
    registry.repositories[index] = entry;
    await writeRegistry(registry);
    return NextResponse.json(entry);
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, context: Context) {
  try {
    const params = await context.params;
    const project = decodeURIComponent(params.project);
    const repoName = decodeURIComponent(params.repoName);
    const registry = await readRegistry();
    const next = registry.repositories.filter(
      (item) => !(item.project === project && item.repoName === repoName),
    );
    if (next.length === registry.repositories.length) {
      return NextResponse.json({ error: 'Repository not found.' }, { status: 404 });
    }

    registry.repositories = next;
    await writeRegistry(registry);
    return NextResponse.json({ removed: { project, repoName } });
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 400 });
  }
}
