/**
 * Deterministic discovery of the codexbar binary with injected dependencies
 * for zero filesystem side-effects in tests.
 */

export interface CodexbarBinaryDiscoveryDeps {
  platform: NodeJS.Platform;
  pathLookup: (name: string) => string | null;
  fileExists: (path: string) => boolean;
}

const CANONICAL_DARWIN_PATH = '/usr/local/bin/codexbar';

/** Resolve from PATH lookup, returning null when not found. */
function resolveFromPath(pathLookup: CodexbarBinaryDiscoveryDeps['pathLookup']): string | null {
  return pathLookup('codexbar');
}

export function discoverCodexbarBinary(deps: CodexbarBinaryDiscoveryDeps): string {
  // On macOS, prefer the canonical install location.
  if (deps.platform === 'darwin' && deps.fileExists(CANONICAL_DARWIN_PATH)) {
    return CANONICAL_DARWIN_PATH;
  }

  // All platforms fall back to PATH lookup.
  const fromPath = resolveFromPath(deps.pathLookup);
  if (fromPath !== null) {
    return fromPath;
  }

  throw new Error('codexbar binary not found');
}
