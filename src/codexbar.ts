import { existsSync } from 'node:fs';
import { execSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 120_000;

const SEARCH_PATHS = [
  '/usr/local/bin/codexbar',
  '/usr/bin/codexbar',
  '/opt/homebrew/bin/codexbar',
];

function discoverBinaryImpl(): string {
  for (const candidate of SEARCH_PATHS) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  try {
    const path = execSync('which codexbar', { encoding: 'utf-8' }).trim();
    if (path) {
      return path;
    }
  } catch {}
  throw new Error('codexbar binary not found');
}

export interface ExecOptions {
  json?: boolean;
  timeoutMs?: number;
}

async function execImpl<T = void>(binaryPath: string, args: string[], options?: ExecOptions): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const { stdout } = await execFileAsync(binaryPath, args, { timeout: timeoutMs });
    if (options?.json) {
      return JSON.parse(stdout) as T;
    }
    return undefined as T;
  } catch (err: unknown) {
    const e = err as { killed?: boolean; code?: string; stderr?: string; stdout?: string };
    if (e.killed || e.code === 'ETIMEDOUT') {
      throw new Error(`codexbar timed out: ${args.join(' ')}`);
    }
    if (options?.json && e.stdout) {
      try {
        return JSON.parse(e.stdout) as T;
      } catch {}
    }
    throw new Error(`codexbar failed: ${e.stderr ?? String(err)}`);
  }
}

export const cli = {
  exec: execImpl,
  discoverBinary: discoverBinaryImpl,
};
