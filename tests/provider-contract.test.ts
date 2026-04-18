import test from 'node:test';
import assert from 'node:assert/strict';
import { isKnownProvider, classifyError } from '../src/usage.ts';

test('isKnownProvider returns false for unknown', () => {
  assert.equal(isKnownProvider('unknown'), false);
});

test('isKnownProvider returns false for empty string', () => {
  assert.equal(isKnownProvider(''), false);
});

test('isKnownProvider returns false for whitespace', () => {
  assert.equal(isKnownProvider('   '), false);
});

test('isKnownProvider returns false for undefined', () => {
  assert.equal(isKnownProvider(undefined), false);
});

test('isKnownProvider returns true for mapped providers', () => {
  // 'claude' and 'anthropic' are in the default provider-mappings.json
  assert.equal(isKnownProvider('claude'), true);
  assert.equal(isKnownProvider('anthropic'), true);
});

test('isKnownProvider returns true for provider mapping values', () => {
  // The mapping value for 'claude' in default mappings is also 'claude'
  // so this should be true
  assert.equal(isKnownProvider('claude'), true);
});

test('classifyError: auth error', () => {
  assert.equal(classifyError('Authentication required'), 'auth');
});

test('classifyError: session error', () => {
  assert.equal(classifyError('Session expired'), 'session');
});

test('classifyError: provider error', () => {
  assert.equal(classifyError('Provider not found'), 'provider');
});

test('classifyError: unknown error', () => {
  assert.equal(classifyError('Something went wrong'), 'unknown');
});