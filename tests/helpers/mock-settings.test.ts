import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { mockSettings } from './mock-settings.ts';

describe('mock-settings helper', () => {
  it('mocks loadSettings and updateSetting in-memory without touching filesystem', async (t) => {
    const homeBefore = process.env.HOME;

    const handle = mockSettings(t, { enabled: false });

    const settings = await import('../../src/settings.ts');

    assert.strictEqual(settings.loadSettings().enabled, false);

    settings.updateSetting('enabled', true);

    assert.strictEqual(handle.get().enabled, true);
    assert.strictEqual(settings.loadSettings().enabled, true);
    assert.strictEqual(process.env.HOME, homeBefore);
  });

  test('updateSetting deep-merges footer', async (t) => {
    const handle = mockSettings(t);
    const settings = await import('../../src/settings.ts');
    settings.updateSetting('footer', { placement: 'aboveEditor' } as any);
    assert.equal(handle.get().footer.placement, 'aboveEditor');
    assert.ok(handle.get().footer.format.length > 0); // format preserved
  });
});
