import { NextRequest, NextResponse } from 'next/server';
import { publicError } from '../mantis';
import { normalizeRepo, readRegistry, writeRegistry } from './store';

export async function GET() {
  try {
    const registry = await readRegistry();
    return NextResponse.json(registry);
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const entry = normalizeRepo(await request.json());
    const registry = await readRegistry();
    const exists = registry.repositories.some(
      (item) => item.project === entry.project && item.repoName === entry.repoName,
    );
    if (exists) {
      return NextResponse.json({ error: 'Repository already exists.' }, { status: 409 });
    }

    registry.repositories.push(entry);
    await writeRegistry(registry);
    return NextResponse.json(entry);
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 400 });
  }
}
