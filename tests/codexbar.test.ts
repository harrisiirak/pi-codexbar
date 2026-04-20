import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { discoverBinary, cli } from '../src/codexbar.ts';

describe('codexbar', () => {
  test('discoverBinary is a function', () => {
    assert.equal(typeof discoverBinary, 'function');
  });

  test('cli.exec is a function', () => {
    assert.equal(typeof cli.exec, 'function');
  });
});
