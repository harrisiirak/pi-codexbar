import { describe, expect, it } from 'vitest';
import { main } from '../../src/index.js';

describe('scaffold smoke test', () => {
  it('returns initialization message', () => {
    expect(main()).toBe('pi-codexbar scaffold initialized');
  });
});
