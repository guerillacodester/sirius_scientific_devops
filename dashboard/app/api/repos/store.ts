import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type RepoEntry = {
  project: string;
  repoName: string;
  provider: string;
  url: string;
  defaultBranch: string;
  localPath: string;
  notes: string;
};

type RepoRegistry = {
  repositories: RepoEntry[];
};

const registryPath = path.resolve(process.cwd(), '..', 'config', 'repos.json');

export async function readRegistry(): Promise<RepoRegistry> {
  const raw = await readFile(registryPath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<RepoRegistry>;
  return { repositories: Array.isArray(parsed.repositories) ? parsed.repositories : [] };
}

export async function writeRegistry(registry: RepoRegistry) {
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

export function normalizeRepo(input: Partial<RepoEntry>): RepoEntry {
  const entry = {
    project: String(input.project ?? '').trim(),
    repoName: String(input.repoName ?? '').trim(),
    provider: String(input.provider ?? 'github').trim() || 'github',
    url: String(input.url ?? '').trim(),
    defaultBranch: String(input.defaultBranch ?? 'main').trim() || 'main',
    localPath: String(input.localPath ?? '').trim(),
    notes: String(input.notes ?? '').trim(),
  };

  if (!entry.project || !entry.repoName || !entry.url) {
    throw new Error('project, repoName, and url are required.');
  }

  return entry;
}
