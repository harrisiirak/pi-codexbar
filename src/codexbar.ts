import { existsSync } from 'node:fs';
import { execSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 5000;

export function discoverBinary(): string {
  if (process.platform === 'darwin' && existsSync('/usr/local/bin/codexbar')) {
    return '/usr/local/bin/codexbar';
  }

  try {
    const path = execSync('which codexbar', { encoding: 'utf-8' }).trim();
    if (path) return path;
  } catch {}

  throw new Error('codexbar binary not found');
}

export async function runJson<T>(binaryPath: string, args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  try {
    const { stdout } = await execFileAsync(binaryPath, args, { timeout: timeoutMs });
    return JSON.parse(stdout) as T;
  } catch (err: unknown) {
    const e = err as { killed?: boolean; code?: string; stderr?: string; stdout?: string };
    if (e.killed || e.code === 'ETIMEDOUT') {
      throw new Error(`codexbar timed out: ${args.join(' ')}`);
    }
    if (e.stdout) {
      try { return JSON.parse(e.stdout) as T; } catch {}
    }
    throw new Error(`codexbar failed: ${e.stderr ?? String(err)}`);
  }
}

// run() is for commands that don't return JSON (e.g. provider switch).
// runJson() is for commands that return JSON (e.g. provider list).
export async function run(binaryPath: string, args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
  try {
    await execFileAsync(binaryPath, args, { timeout: timeoutMs });
  } catch (err: unknown) {
    const e = err as { killed?: boolean; code?: string; stderr?: string };
    if (e.killed || e.code === 'ETIMEDOUT') {
      throw new Error(`codexbar timed out: ${args.join(' ')}`);
    }
    throw new Error(`codexbar failed: ${e.stderr ?? String(err)}`);
  }
}
