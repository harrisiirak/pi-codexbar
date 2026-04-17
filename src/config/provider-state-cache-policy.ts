/**
 * Cache policy constants and freshness rule for provider state.
 *
 * This module contains constants and pure logic only — no filesystem I/O.
 */

/** Relative path (from project root) where the cached provider-state JSON lives. */
export const providerStateCacheRelativePath = '.pi-cache/provider-state.json';

/** Time-to-live for the provider-state cache in milliseconds (15 seconds). */
export const providerStateCacheTtlMs = 15_000;

/**
 * Determine whether a cached provider-state entry is still fresh.
 *
 * @param cachedAtEpochMs - Epoch ms when the cache entry was written.
 * @param nowEpochMs      - Current epoch ms (caller controls the clock).
 * @param ttlMs           - TTL in ms; defaults to {@link providerStateCacheTtlMs}.
 * @returns `true` when `(now - cachedAt) < ttl`, i.e. strictly under the TTL;
 *          `false` once age reaches or exceeds the TTL.
 */
export function isProviderStateCacheFresh(
  cachedAtEpochMs: number,
  nowEpochMs: number,
  ttlMs: number = providerStateCacheTtlMs,
): boolean {
  return nowEpochMs - cachedAtEpochMs < ttlMs;
}
