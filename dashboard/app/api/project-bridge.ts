import { execFile } from 'node:child_process';
import path from 'node:path';

export async function projectBridge(input: { operation: 'configure' | 'note-update' | 'planning-update'; projectId: number; itemId?: number; noteId?: number; text?: string; payload?: Record<string, unknown> }) {
  const root = path.resolve(process.cwd(), '..');
  return new Promise<void>((resolve, reject) => {
    const child = execFile(path.join(root, 'php', 'php.exe'), [path.join(root, 'scripts', 'project-agent-bridge.php')], { windowsHide: true, timeout: 30000, maxBuffer: 65536 }, (error, stdout) => {
      if (error) { reject(new Error('Mantis project operation failed. Check local Mantis permissions and required fields.')); return; }
      try { if (!JSON.parse(stdout).ok) throw new Error(); resolve(); }
      catch { reject(new Error('Mantis project operation returned an invalid result.')); }
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(JSON.stringify(input));
  });
}
