import type { ProviderState, ProviderDescriptor } from './provider-state-contract.ts';

// ── Tiny runtime validators ─────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(obj: Record<string, unknown>, key: string): string {
  const val = obj[key];
  if (typeof val !== 'string') {
    throw new Error(`Expected string for key "${key}", got ${typeof val}`);
  }
  return val;
}

function readBoolean(obj: Record<string, unknown>, key: string): boolean {
  const val = obj[key];
  if (typeof val !== 'boolean') {
    throw new Error(`Expected boolean for key "${key}", got ${typeof val}`);
  }
  return val;
}

// ── Normalizer ─────────────────────────────────────────────────────────

/**
 * Normalize raw CodexBar CLI JSON into a ProviderState.
 *
 * External shape:
 *   { providers: [{ id, name, active }], active_provider: string }
 *
 * Internal shape (ProviderState):
 *   { providers: [{ id, label, enabled }], selectedProviderId, fetchedAtEpochMs }
 */
export function normalizeProviderState(raw: unknown, nowEpochMs: number): ProviderState {
  if (!isRecord(raw)) {
    throw new Error('Payload must be a non-null object');
  }

  // Validate providers array
  const providersVal = raw['providers'];
  if (!Array.isArray(providersVal)) {
    throw new Error('Payload "providers" must be an array');
  }

  // Validate active_provider
  const activeProvider = readString(raw, 'active_provider');

  // Map each provider entry
  const providers: ProviderDescriptor[] = providersVal.map((entry: unknown, index: number) => {
    if (!isRecord(entry)) {
      throw new Error(`Provider entry at index ${index} must be a non-null object`);
    }
    return {
      id: readString(entry, 'id'),
      label: readString(entry, 'name'),
      enabled: readBoolean(entry, 'active'),
    };
  });

  // Verify active_provider references a real provider
  const knownIds = new Set(providers.map((p) => p.id));
  if (!knownIds.has(activeProvider)) {
    throw new Error(
      `active_provider "${activeProvider}" does not match any provider id`,
    );
  }

  return {
    providers,
    selectedProviderId: activeProvider,
    fetchedAtEpochMs: nowEpochMs,
  };
}
