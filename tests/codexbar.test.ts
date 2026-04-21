import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cli } from '../src/codexbar.ts';

describe('codexbar', () => {
  test('cli.discoverBinary is a function', () => {
    assert.equal(typeof cli.discoverBinary, 'function');
  });

  test('cli.exec is a function', () => {
    assert.equal(typeof cli.exec, 'function');
  });
});
