/**
 * Reusable test helper for building ShellRunResult stubs.
 * Import the ShellRunResult type from the production module so
 * stubs stay in sync with the real interface.
 */

import type { ShellRunResult } from '../../src/core/codexbar-json-command.ts';

/** Build a successful ShellRunResult (exit 0, no stderr, not timed out). */
export function successResult(stdout: string): ShellRunResult {
  return { exitCode: 0, stdout, stderr: '', timedOut: false };
}

/** Build a non-zero exit ShellRunResult with optional stderr. */
export function errorResult(
  exitCode: number,
  stdout: string = '',
  stderr: string = '',
): ShellRunResult {
  return { exitCode, stdout, stderr, timedOut: false };
}

/** Build a timed-out ShellRunResult. */
export function timeoutResult(partialStdout: string = ''): ShellRunResult {
  return { exitCode: -1, stdout: partialStdout, stderr: '', timedOut: true };
}
