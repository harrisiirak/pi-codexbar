/**
 * CodexBar JSON command wrapper with injected shell runner.
 *
 * Runs a CodexBar CLI subcommand, parses stdout as JSON, and provides
 * structured errors for non-zero exits, parse failures, and timeouts.
 */

export interface ShellRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface CodexbarJsonCommandDeps {
  run: (binaryPath: string, args: string[], timeoutMs: number) => Promise<ShellRunResult>;
}

export type CodexbarCommandErrorCategory = 'non-zero-exit' | 'parse' | 'timeout';

export interface CodexbarCommandError {
  category: CodexbarCommandErrorCategory;
  exitCode?: number;
  stdoutSnippet?: string;
  stderrSnippet?: string;
}

/** Create a structured CodexbarCommandError with a message. */
function createCommandError(
  category: CodexbarCommandErrorCategory,
  opts: { exitCode?: number; stdoutSnippet?: string; stderrSnippet?: string },
): Error & CodexbarCommandError {
  const message = `codexbar command failed: ${category}`;
  const err = Object.assign(new Error(message), {
    category,
    ...opts,
  }) as Error & CodexbarCommandError;
  return err;
}

export async function runCodexbarJson<T>(
  deps: CodexbarJsonCommandDeps,
  binaryPath: string,
  args: string[],
  timeoutMs: number,
): Promise<T> {
  const result = await deps.run(binaryPath, args, timeoutMs);

  if (result.timedOut) {
    throw createCommandError('timeout', { exitCode: result.exitCode });
  }

  if (result.exitCode !== 0) {
    throw createCommandError('non-zero-exit', {
      exitCode: result.exitCode,
      stderrSnippet: result.stderr,
    });
  }

  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw createCommandError('parse', {
      stdoutSnippet: result.stdout,
    });
  }
}
