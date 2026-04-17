import test from 'node:test';
import assert from 'node:assert/strict';

import {
  providerStateCacheRelativePath,
  providerStateCacheTtlMs,
  isProviderStateCacheFresh,
} from '../../../src/config/provider-state-cache-policy.ts';

// ── Constants ──────────────────────────────────────────────────────────

test('providerStateCacheRelativePath is .pi-cache/provider-state.json', () => {
  assert.equal(providerStateCacheRelativePath, '.pi-cache/provider-state.json');
});

test('providerStateCacheTtlMs is 15 000 ms (15 seconds)', () => {
  assert.equal(providerStateCacheTtlMs, 15_000);
});

// ── Freshness helper – boundary table ──────────────────────────────────

const BASE = 1_700_000_000_000;

interface BoundaryCase {
  label: string;
  cachedAt: number;
  now: number;
  ttlMs: number;
  expected: boolean;
}

const defaultTtlCases: BoundaryCase[] = [
  { label: 'age 0 → fresh',                    cachedAt: BASE, now: BASE,                               ttlMs: providerStateCacheTtlMs, expected: true  },
  { label: 'age ttlMs - 1 → fresh (boundary)', cachedAt: BASE, now: BASE + providerStateCacheTtlMs - 1,  ttlMs: providerStateCacheTtlMs, expected: true  },
  { label: 'age ttlMs → stale (boundary)',     cachedAt: BASE, now: BASE + providerStateCacheTtlMs,      ttlMs: providerStateCacheTtlMs, expected: false },
  { label: 'age ttlMs + 1 → stale',           cachedAt: BASE, now: BASE + providerStateCacheTtlMs + 1,  ttlMs: providerStateCacheTtlMs, expected: false },
];

for (const { label, cachedAt, now, ttlMs, expected } of defaultTtlCases) {
  test(`isProviderStateCacheFresh: ${label}`, () => {
    assert.equal(isProviderStateCacheFresh(cachedAt, now, ttlMs), expected);
  });
}

// ── Custom TTL override ────────────────────────────────────────────────

const customTtl = 5_000;
const customTtlCases: BoundaryCase[] = [
  { label: 'custom ttl: age 4 999 → fresh', cachedAt: BASE, now: BASE + customTtl - 1, ttlMs: customTtl, expected: true  },
  { label: 'custom ttl: age 5 000 → stale', cachedAt: BASE, now: BASE + customTtl,      ttlMs: customTtl, expected: false },
];

for (const { label, cachedAt, now, ttlMs, expected } of customTtlCases) {
  test(`isProviderStateCacheFresh: ${label}`, () => {
    assert.equal(isProviderStateCacheFresh(cachedAt, now, ttlMs), expected);
  });
}
