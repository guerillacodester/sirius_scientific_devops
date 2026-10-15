import { readFile } from 'node:fs/promises';
import path from 'node:path';

type MantisConfig = {
  baseUrl: string;
  apiToken: string;
};

export function publicError(error: unknown) {
  return String(error)
    .replace(/Authorization:\s*[^\s,}]+/gi, 'Authorization: [redacted]')
    .replace(/apiToken["']?\s*[:=]\s*["']?[^"',}\s]+/gi, 'apiToken: [redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
}

export async function readMantisConfig(): Promise<MantisConfig> {
  const configPath = path.resolve(process.cwd(), '..', 'tools', 'mantis.config.json');
  const raw = await readFile(configPath, 'utf8');
  const config = JSON.parse(raw) as MantisConfig;
  if (!config.baseUrl || !config.apiToken) {
    throw new Error('Mantis config must include baseUrl and apiToken.');
  }
  return config;
}

export async function mantisFetch<T>(requestPath: string, init: RequestInit = {}): Promise<T> {
  const config = await readMantisConfig();
  const url = `${config.baseUrl.replace(/\/$/, '')}${requestPath}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: config.apiToken,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error(publicError(`Mantis request failed ${response.status}: ${text}`)), { status: response.status });
  }

  const text = await response.text();
  if (!text) {
    return null as T;
  }

  return JSON.parse(text) as T;
}
