import type { TestContext } from 'node:test';
import { cli } from '../../src/codexbar.ts';
import type { ExecOptions } from '../../src/codexbar.ts';

export interface MockCall {
  args: string[];
  options?: ExecOptions;
}

export function mockExec(t: TestContext, responses: Record<string, unknown>) {
  const calls: MockCall[] = [];

  t.mock.method(cli, 'exec', async (_binaryPath: string, args: string[], options?: ExecOptions) => {
    const key = args.join(' ');
    calls.push({ args: [...args], options });

    if (key in responses) {
      let value = responses[key];
      if (typeof value === 'function') {
        value = value();
      }
      if (options?.json) {
        return typeof value === 'string' ? JSON.parse(value) : value;
      }
      return undefined;
    }
    throw new Error(`codexbar failed: unknown: ${key}`);
  });

  return {
    getCalls: () => [...calls],
    getCallStrings: () => calls.map(c => c.args.join(' ')),
    reset: () => { calls.length = 0; },
  };
}
