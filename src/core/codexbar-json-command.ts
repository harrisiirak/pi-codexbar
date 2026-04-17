import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function runCodexbarJson<T>(
  binaryPath: string,
  args: string[],
  timeoutMs: number = 5000,
): Promise<T> {
  let stdout: string;
  let stderr: string;

  try {
    const result = await execFileAsync(binaryPath, args, { timeout: timeoutMs });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err: unknown) {
    const e = err as { killed?: boolean; code?: string; stdout?: string; stderr?: string };
    if (e.killed || e.code === 'ETIMEDOUT') {
      throw new Error(`codexbar command timed out: ${args.join(' ')}`);
    }
    throw new Error(`codexbar command failed: ${e.stderr ?? ''}`);
  }

  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error(`codexbar returned invalid JSON: ${stdout.slice(0, 200)}`);
  }
}
