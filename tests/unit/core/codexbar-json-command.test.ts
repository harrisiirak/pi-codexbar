import test from 'node:test';
import assert from 'node:assert/strict';

import {
  type CodexbarJsonCommandDeps,
  type ShellRunResult,
  type CodexbarCommandError,
  runCodexbarJson,
} from '../../../src/core/codexbar-json-command.ts';
import { successResult, errorResult, timeoutResult } from '../../helpers/fake-shell-runner.ts';

// ── Helpers ────────────────────────────────────────────────────────────

/** Build a CodexbarJsonCommandDeps whose `run` returns the given result. */
function depsFromResult(result: ShellRunResult): CodexbarJsonCommandDeps {
  return {
    run: async () => result,
  };
}

/** Build deps whose `run` returns success with the given stdout. */
function depsFromStdout(stdout: string): CodexbarJsonCommandDeps {
  return depsFromResult(successResult(stdout));
}

// ── Module resolves at runtime ────────────────────────────────────────
test('codexbar-json-command module is importable at runtime', async () => {
  const mod = await import('../../../src/core/codexbar-json-command.ts');
  assert.ok(mod, 'module should resolve');
});

// ── Successful JSON parse from stdout ─────────────────────────────────
test('returns parsed object when stdout is valid JSON', async () => {
  const data = { providers: [{ id: 'openai', label: 'OpenAI', enabled: true }] };
  const deps = depsFromStdout(JSON.stringify(data));
  const result = await runCodexbarJson<ReturnType<typeof data>>(
    deps,
    '/usr/local/bin/codexbar',
    ['status', '--json'],
    5000,
  );
  assert.deepEqual(result, data);
});

test('returns parsed primitive when stdout is a JSON primitive', async () => {
  const deps = depsFromStdout('"ok"');
  const result = await runCodexbarJson<string>(deps, '/usr/local/bin/codexbar', ['check'], 1000);
  assert.equal(result, 'ok');
});

// ── Non-zero exit includes exit code + stderr snippet ─────────────────
test('throws CodexbarCommandError with category "non-zero-exit" on failure', async () => {
  const deps = depsFromResult(errorResult(1, '', 'connection refused'));
  await assert.rejects(
    () => runCodexbarJson(deps, '/usr/local/bin/codexbar', ['status', '--json'], 5000),
    (err: unknown) => {
      assert.ok(err instanceof Error, 'must be an Error instance');
      const cmdErr = err as CodexbarCommandError;
      assert.equal(cmdErr.category, 'non-zero-exit');
      assert.equal(cmdErr.exitCode, 1);
      assert.ok(cmdErr.stderrSnippet.includes('connection refused'), 'stderr snippet present');
      return true;
    },
  );
});

// ── Invalid JSON throws parse error with stdout snippet ───────────────
test('throws CodexbarCommandError with category "parse" on invalid JSON', async () => {
  const deps = depsFromStdout('{not valid json!!!');
  await assert.rejects(
    () => runCodexbarJson(deps, '/usr/local/bin/codexbar', ['status', '--json'], 5000),
    (err: unknown) => {
      assert.ok(err instanceof Error, 'must be an Error instance');
      const cmdErr = err as CodexbarCommandError;
      assert.equal(cmdErr.category, 'parse');
      assert.ok(cmdErr.stdoutSnippet.includes('{not valid json'), 'stdout snippet present');
      return true;
    },
  );
});

// ── Timeout path throws "timeout" failure category ────────────────────
test('throws CodexbarCommandError with category "timeout" when timed out', async () => {
  const deps = depsFromResult(timeoutResult('partial'));
  await assert.rejects(
    () => runCodexbarJson(deps, '/usr/local/bin/codexbar', ['status', '--json'], 1000),
    (err: unknown) => {
      assert.ok(err instanceof Error, 'must be an Error instance');
      const cmdErr = err as CodexbarCommandError;
      assert.equal(cmdErr.category, 'timeout');
      return true;
    },
  );
});
