import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isKnownProvider, classifyError } from '../src/usage.ts';

describe('isKnownProvider', () => {
  test('returns false for "unknown"', () => {
    assert.equal(isKnownProvider('unknown'), false);
  });

  test('returns false for empty string', () => {
    assert.equal(isKnownProvider(''), false);
  });

  test('returns false for whitespace', () => {
    assert.equal(isKnownProvider('   '), false);
  });

  test('returns false for undefined', () => {
    assert.equal(isKnownProvider(undefined), false);
  });

  test('returns true for mapped providers', () => {
    assert.equal(isKnownProvider('claude'), true);
    assert.equal(isKnownProvider('anthropic'), true);
  });

  test('returns true for provider mapping values', () => {
    assert.equal(isKnownProvider('claude'), true);
  });
});

describe('classifyError', () => {
  test('auth error', () => {
    assert.equal(classifyError('Authentication required'), 'auth');
  });

  test('session error', () => {
    assert.equal(classifyError('Session expired'), 'session');
  });

  test('provider error', () => {
    assert.equal(classifyError('Provider not found'), 'provider');
  });

  test('unknown error', () => {
    assert.equal(classifyError('Something went wrong'), 'unknown');
  });
});
