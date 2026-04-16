import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../src/index.ts';

test('scaffold smoke test returns initialization message', () => {
  assert.equal(main(), 'pi-codexbar scaffold initialized');
});
