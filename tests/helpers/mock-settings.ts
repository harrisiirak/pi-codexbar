import type { TestContext } from 'node:test';
import type { CodexBarSettings } from '../../src/settings.ts';
import * as realSettings from '../../src/settings.ts';

const DEFAULTS: CodexBarSettings = {
  enabled: true,
  footer: {
    format: '{provider} {plan} │ {session} │ {weekly}{monthly} │ {credits} │ ⏱ {session_reset}',
    placement: 'belowEditor',
  },
  colors: {
    provider: '#d787af', plan: '#808080', session: '#5faf5f', sessionHigh: '#ff5f5f',
    weekly: '#00afaf', weeklyHigh: '#ff8700', monthly: '#af87d7', monthlyHigh: '#ff5f5f',
    reset: '#808080', separator: '#4e4e4e', credits: '#febc38', error: '#ff5f5f',
    highThreshold: 80,
  },
};

export interface MockSettingsHandle {
  get(): CodexBarSettings;
}

export function mockSettings(
  t: TestContext,
  initial?: Partial<CodexBarSettings>,
): MockSettingsHandle {
  let state: CodexBarSettings = {
    ...DEFAULTS,
    ...initial,
    footer: { ...DEFAULTS.footer, ...initial?.footer },
    colors: { ...DEFAULTS.colors, ...initial?.colors },
  };

  t.mock.module('../../src/settings.ts', {
    namedExports: {
      ...realSettings,
      loadSettings: () => state,
      updateSetting: <K extends keyof CodexBarSettings>(key: K, value: CodexBarSettings[K]) => {
        if (key === 'footer' || key === 'colors') {
          state = { ...state, [key]: { ...(state[key] as object), ...(value as object) } } as CodexBarSettings;
        } else {
          state = { ...state, [key]: value };
        }
      },
    },
  });

  return {
    get() {
      return state;
    },
  };
}
