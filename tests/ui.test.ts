import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatUsageFooter } from '../src/ui.ts';
import { stripAnsi } from '../src/settings.ts';
import type { UsageState } from '../src/usage.ts';

describe('formatUsageFooter', () => {
  test('success shows provider, plan, session, weekly, reset', () => {
    const state: UsageState = {
      selectedProvider: 'claude',
      entries: [{
        providerId: 'claude',
        status: 'ok',
        metrics: {
          primary: { usedPercent: 42, windowMinutes: 300, resetsAt: '2026-05-01T00:00:00Z', resetDescription: 'May 1 at 3:00AM' },
          secondary: { usedPercent: 15, windowMinutes: 10080, resetsAt: '2026-05-07T00:00:00Z', resetDescription: 'May 7' },
          tertiary: null,
          creditsRemaining: null,
          loginMethod: 'Claude Max',
          updatedAt: '2026-04-18T14:00:00Z',
        },
      }],
      fetchedAt: Date.now(),
    };

    const plain = stripAnsi(formatUsageFooter(state));
    assert.match(plain, /claude/i);
    assert.match(plain, /Claude Max/);
    assert.match(plain, /42%/);
    assert.match(plain, /15%/);
    assert.match(plain, /May 1/);
  });

  test('error entry shows error message', () => {
    const state: UsageState = {
      selectedProvider: 'anthropic',
      entries: [{
        providerId: 'anthropic',
        status: 'error',
        error: { kind: 'auth', message: 'Not logged in' },
      }],
      fetchedAt: Date.now(),
    };

    const plain = stripAnsi(formatUsageFooter(state));
    assert.match(plain, /anthropic/i);
    assert.match(plain, /Not logged in/);
  });

  test('monthly shown when tertiary exists', () => {
    const state: UsageState = {
      selectedProvider: 'codex',
      entries: [{
        providerId: 'codex',
        status: 'ok',
        metrics: {
          primary: { usedPercent: 10, windowMinutes: 300, resetsAt: null, resetDescription: null },
          secondary: { usedPercent: 5, windowMinutes: 10080, resetsAt: null, resetDescription: null },
          tertiary: { usedPercent: 2, windowMinutes: 43200, resetsAt: null, resetDescription: null },
          creditsRemaining: null,
          loginMethod: null,
          updatedAt: null,
        },
      }],
      fetchedAt: Date.now(),
    };

    const plain = stripAnsi(formatUsageFooter(state));
    assert.match(plain, /M\(1mo\).*2%/);
  });

  test('returns ANSI-colored output', () => {
    const state: UsageState = {
      selectedProvider: 'claude',
      entries: [{
        providerId: 'claude',
        status: 'ok',
        metrics: {
          primary: { usedPercent: 10, windowMinutes: 300, resetsAt: null, resetDescription: null },
          secondary: null,
          tertiary: null,
          creditsRemaining: null,
          loginMethod: null,
          updatedAt: null,
        },
      }],
      fetchedAt: Date.now(),
    };

    const colored = formatUsageFooter(state);
    assert.ok(colored.includes('\x1b['), 'should contain ANSI codes');
    assert.ok(!stripAnsi(colored).includes('\x1b['), 'stripped should not contain ANSI');
  });

  test('rounds fractional usage percentages', () => {
    const state: UsageState = {
      selectedProvider: 'kimi',
      entries: [{
        providerId: 'kimi',
        status: 'ok',
        metrics: {
          primary: { usedPercent: 7.000000000000001, windowMinutes: 300, resetsAt: null, resetDescription: null },
          secondary: { usedPercent: 5, windowMinutes: 10080, resetsAt: null, resetDescription: null },
          tertiary: null,
          creditsRemaining: null,
          loginMethod: null,
          updatedAt: null,
        },
      }],
      fetchedAt: Date.now(),
    };

    const plain = stripAnsi(formatUsageFooter(state));
    assert.ok(plain.includes('7%'), 'primary should round to 7%');
    assert.ok(plain.includes('5%'), 'secondary should show 5%');
    assert.ok(!plain.includes('7.000000000000001%'), 'should not show raw float');
  });

  test('drops ASCII separators around empty monthly section', () => {
    const state: UsageState = {
      selectedProvider: 'kimi',
      entries: [{
        providerId: 'kimi',
        status: 'ok',
        metrics: {
          primary: { usedPercent: 7, windowMinutes: 300, resetsAt: null, resetDescription: null },
          secondary: { usedPercent: 5, windowMinutes: 10080, resetsAt: null, resetDescription: null },
          tertiary: null,
          creditsRemaining: null,
          loginMethod: null,
          updatedAt: null,
        },
      }],
      fetchedAt: Date.now(),
    };

    const plain = stripAnsi(formatUsageFooter(state));
    assert.ok(!plain.includes('|'), 'should not leave ASCII separator when monthly is empty');
  });
});

describe('stripAnsi', () => {
  test('removes ANSI escape codes', () => {
    assert.equal(stripAnsi('\x1b[38;2;215;135;175mclaude\x1b[0m'), 'claude');
  });
});
