import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type AgentRole = 'reader' | 'editor' | 'owner';
type Key = { id: string; projectId: number; name: string; role: AgentRole; hash: string; createdAt: string; expiresAt: string; revokedAt?: string };
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const publicKey = ({ hash: _hash, ...key }: Key) => key;

export function createAccessStore(file: string) {
  async function read(): Promise<Key[]> {
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  async function change<T>(update: (keys: Key[]) => T): Promise<T> {
    await mkdir(path.dirname(file), { recursive: true });
    // Exclusive creation also serializes writers in separate server processes.
    const lock = await open(`${file}.lock`, 'wx', 0o600);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const keys = await read();
      const result = update(keys);
      await writeFile(temporary, JSON.stringify(keys), { mode: 0o600, flag: 'wx' });
      await rename(temporary, file);
      return result;
    } finally {
      await lock.close();
      await unlink(`${file}.lock`);
      await unlink(temporary).catch(() => {});
    }
  }
  return {
    async list(projectId: number) { return (await read()).filter((key) => key.projectId === projectId).map(publicKey); },
    async issue(projectId: number, name: string, role: AgentRole, days = 90) {
      if (!Number.isSafeInteger(projectId) || projectId < 1 || typeof name !== 'string' || !name.trim() || name.length > 100 || !['reader', 'editor', 'owner'].includes(role) || !Number.isInteger(days) || days < 1 || days > 365) throw new Error('Invalid credential settings.');
      const token = `ssdo_${randomBytes(32).toString('hex')}`;
      const key: Key = { id: randomUUID(), projectId, name: name.trim(), role, hash: digest(token), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + days * 86400000).toISOString() };
      await change((keys) => keys.push(key));
      return { token, key: publicKey(key) };
    },
    async revoke(projectId: number, id: string) {
      return change((keys) => {
        const key = keys.find((entry) => entry.projectId === projectId && entry.id === id);
        if (!key) return false;
        key.revokedAt = new Date().toISOString(); return true;
      });
    },
    async authenticate(projectId: number, token: string) {
      if (!/^ssdo_[a-f0-9]{64}$/.test(token)) return null;
      const hash = digest(token);
      const key = (await read()).find((entry) => entry.projectId === projectId && !entry.revokedAt && Date.parse(entry.expiresAt) > Date.now() && typeof entry.hash === 'string' && entry.hash.length === hash.length && timingSafeEqual(Buffer.from(entry.hash), Buffer.from(hash)));
      return key ? publicKey(key) : null;
    },
  };
}

export const agentAccess = createAccessStore(path.resolve(process.cwd(), '..', 'config', 'agent-keys.json'));

export function localOperatorRequest(request: Request) {
  const url = new URL(request.url);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'];
  if (!loopback.includes(url.hostname)
    || !['http:', 'https:'].includes(url.protocol)
    || request.headers.get('sec-fetch-site') !== 'same-origin'
    || request.headers.has('authorization')) return false;

  let browserOrigin = url.origin;
  const host = request.headers.get('host');
  if (host) {
    try {
      // Next.js can normalize request.url to localhost while the browser uses 127.0.0.1.
      const incoming = new URL(`${url.protocol}//${host}`);
      if (!loopback.includes(incoming.hostname) || incoming.host !== host || incoming.port !== url.port) return false;
      browserOrigin = incoming.origin;
    } catch { return false; }
  }
  return request.method === 'GET' || request.headers.get('origin') === browserOrigin;
}
