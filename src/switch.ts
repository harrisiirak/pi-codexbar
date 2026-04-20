import type { Model } from '@mariozechner/pi-ai';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getProviderUsageState } from './usage.ts';
import { mapProviderToCodexbar } from './mappings.ts';

export type SwitchAction = 'switch' | 'list';
export type ResolveTier = 'exact' | 'registry' | 'alias' | 'builtin' | 'none';

export interface LoadAliasesResult {
  merged: Record<string, string[]>;
  literalKeys: Record<string, string>; // normalized key → original literal key
  loadedPaths: string[];
  warnings: string[];
}

export interface ResolveResult {
  tier: ResolveTier;
  candidates: Model<any>[];
  unknownKey?: string;
}

export interface ScoredCandidate {
  model: Model<any>;
  remaining: number;
  primaryResetsAt: string | null;
  error?: string;
}

export type RankedResult =
  | { ordered: ScoredCandidate[] }
  | { error: 'all-unavailable' };

export interface SwitchRequest {
  action: SwitchAction;
  query?: string;
  excludeProviders?: string[];
  dryRun?: boolean;
}

export type SwitchListOutcome = {
  kind: 'list';
  tier: ResolveTier;
  candidates: Model<any>[];
  text: string;
};

export type SwitchPreviewOutcome = {
  kind: 'preview';
  text: string;
  winner: Model<any>;
  ordered: ScoredCandidate[];
};

export type SwitchSuccessOutcome = {
  kind: 'switch';
  winner: Model<any>;
  ordered: ScoredCandidate[];
};

export type SwitchErrorOutcome = {
  kind: 'error';
  message: string;
};

export type SwitchOutcome =
  | SwitchListOutcome
  | SwitchPreviewOutcome
  | SwitchSuccessOutcome
  | SwitchErrorOutcome;

export type ParsedSlashArgs =
  | { action: SwitchAction; query?: string; excludeProviders: string[]; dryRun: boolean }
  | { error: string };

const BUILT_IN_KEYS = ['cheap', 'vision', 'reasoning', 'long-context'] as const;
export type BuiltInKey = (typeof BUILT_IN_KEYS)[number];

const LONG_CONTEXT_WINDOW_THRESHOLD = 200_000;

function defaultAliasPaths(): string[] {
  const home = homedir();
  return [
    join(home, '.pi', 'agent', 'extensions', 'model-switch', 'aliases.json'),
    join(home, '.pi', 'agent', 'extensions', 'pi-codexbar', 'aliases.json'),
  ];
}

function isValidTarget(target: string): boolean {
  const idx = target.indexOf('/');
  if (idx <= 0 || idx >= target.length - 1) return false;
  if (target.indexOf('/', idx + 1) !== -1) return false;
  return true;
}

type LoadFn = (path: string, encoding: 'utf-8') => string;

export async function loadAliases(paths?: string[], loadFn: LoadFn = readFileSync): Promise<LoadAliasesResult> {
  const aliasPaths = paths ?? defaultAliasPaths();
  const merged: Record<string, string[]> = {};
  const literalKeys: Record<string, string> = {};
  const loadedPaths: string[] = [];
  const warnings: string[] = [];

  for (const path of aliasPaths) {
    let raw: string;
    try {
      raw = loadFn(path, 'utf-8');
    } catch (err: unknown) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        continue;
      }
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      warnings.push(`Failed to parse JSON in ${path}`);
      continue;
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      warnings.push(`Expected object in ${path}, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`);
      continue;
    }

    loadedPaths.push(path);

    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase().trim();

      let targets: string[];
      if (typeof value === 'string') {
        targets = [value];
      } else if (Array.isArray(value) && value.every((v): v is string => typeof v === 'string')) {
        targets = [...value];
      } else {
        warnings.push(`Alias "${key}" in ${path} has invalid value type (${typeof value}), skipping`);
        continue;
      }

      const validTargets: string[] = [];
      for (const target of targets) {
        if (isValidTarget(target)) {
          validTargets.push(target);
        } else {
          warnings.push(`Alias "${key}" target "${target}" in ${path} is not a valid provider/id format, skipping`);
        }
      }

      if (validTargets.length === 0) continue;

      literalKeys[normalizedKey] = key;
      merged[normalizedKey] = validTargets;
    }
  }

  return { merged, literalKeys, loadedPaths, warnings };
}

export function formatListing(
  builtIns: Record<string, string[]>,
  userAliases: Record<string, string[]>,
  loadedPaths: string[],
): string {
  const lines: string[] = [];

  // Built-in section
  lines.push('Built-in keywords:');
  for (const key of Object.keys(builtIns)) {
    const targets = builtIns[key];
    lines.push(`  ${key}: ${targets.join(', ')}`);
  }

  // User aliases section
  const userKeys = Object.keys(userAliases);
  if (userKeys.length > 0) {
    lines.push('');
    lines.push('User aliases:');
    for (const key of userKeys) {
      const targets = userAliases[key];
      lines.push(`  ${key}: ${targets.join(', ')}`);
    }
  }

  // Loaded paths section
  if (loadedPaths.length > 0) {
    lines.push('');
    lines.push('Loaded from:');
    for (const path of loadedPaths) {
      lines.push(`  ${path}`);
    }
  }

  return lines.join('\n');
}

export function resolveBuiltIn(key: BuiltInKey, models: Model<any>[]): Model<any>[] {
  const totalCost = (m: Model<any>): number => m.cost.input + m.cost.output;

  if (key === 'cheap') {
    return [...models]
      .sort((a, b) => totalCost(a) - totalCost(b))
      .slice(0, 5);
  }
  if (key === 'vision') {
    return models.filter(m => m.input.includes('image'));
  }
  if (key === 'reasoning') {
    return models.filter(m => m.reasoning === true);
  }
  if (key === 'long-context') {
    return models.filter(m => m.contextWindow >= LONG_CONTEXT_WINDOW_THRESHOLD);
  }
  return [];
}

/**
 * Resolve alias targets to model instances.
 *
 * For each target in `provider/id` format:
 * 1. Try exact match (provider AND id) → add it
 * 2. If no exact match, fall back to all models from that provider
 *
 * Deduplicates results by `provider/id`.
 */
function resolveAliasTargets(targets: string[], models: Model<any>[]): Model<any>[] {
  const candidates: Model<any>[] = [];
  const seen = new Set<string>();

  for (const target of targets) {
    const slashIdx = target.indexOf('/');
    if (slashIdx < 0) continue;

    const provider = target.slice(0, slashIdx);
    const id = target.slice(slashIdx + 1);

    const exact = models.find(m => m.provider === provider && m.id === id);
    if (exact) {
      const key = `${exact.provider}/${exact.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(exact);
      }
      continue;
    }

    for (const m of models) {
      if (m.provider === provider) {
        const key = `${m.provider}/${m.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push(m);
        }
      }
    }
  }

  return candidates;
}

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[-./_]+/).filter(Boolean);
}

/**
 * True if `needle` appears as a contiguous subsequence of `haystack`.
 * Empty needle never matches.
 */
function hasContiguousSubsequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) {
    return false;
  }
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      return true;
    }
  }
  return false;
}

export function resolveCandidates(
  query: string,
  models: Model<any>[],
  aliases: Record<string, string[]>,
  excludeProviders?: string[],
): ResolveResult {
  const exclude = new Set(excludeProviders ?? []);
  const q = query.trim();

  if (q.includes('/')) {
    const slashIdx = q.indexOf('/');
    const provider = q.slice(0, slashIdx);
    const id = q.slice(slashIdx + 1);
    const exactMatches = models.filter(m => m.provider === provider && m.id === id);
    if (exactMatches.length > 0) {
      return {
        tier: 'exact',
        candidates: exactMatches.filter(m => !exclude.has(m.provider)),
      };
    }
  }

  const qLower = q.toLowerCase();
  const registryMatches = models.filter(m =>
    m.id.toLowerCase() === qLower ||
    (m.name && m.name.toLowerCase() === qLower) ||
    m.provider.toLowerCase() === qLower
  );
  if (registryMatches.length > 0) {
    return {
      tier: 'registry',
      candidates: registryMatches.filter(m => !exclude.has(m.provider)),
    };
  }

  const aliasTargets = aliases[qLower];
  if (aliasTargets) {
    const candidates = resolveAliasTargets(aliasTargets, models);
    return {
      tier: 'alias',
      candidates: candidates.filter(m => !exclude.has(m.provider)),
    };
  }

  const builtInModels = resolveBuiltIn(q as BuiltInKey, models);
  if (builtInModels.length > 0) {
    return {
      tier: 'builtin',
      candidates: builtInModels.filter(m => !exclude.has(m.provider)),
    };
  }

  const queryTokens = tokenize(q);
  if (queryTokens.length > 0) {
    const tokenMatches = models.filter(m => hasContiguousSubsequence(tokenize(m.id), queryTokens));
    if (tokenMatches.length > 0) {
      return {
        tier: 'registry',
        candidates: tokenMatches.filter(m => !exclude.has(m.provider)),
      };
    }
  }

  return { tier: 'none', candidates: [], unknownKey: q };
}

/**
 * Score candidates by fetching usage state and computing remaining budget.
 *
 * For each model's provider, calls getProviderUsageState to retrieve usage metrics.
 * remaining = 100 - max(primary.usedPercent, secondary.usedPercent, tertiary.usedPercent).
 * If usage state is unavailable for a provider, the candidate gets an error flag
 * but is still included in the results.
 */
export async function scoreCandidates(models: Model<any>[]): Promise<ScoredCandidate[]> {
  // Deduplicate by provider (using CodexBar id) to avoid redundant fetches
  const providerState = new Map<string, any>();
  for (const m of models) {
    const cbProvider = mapProviderToCodexbar(m.provider);
    if (!providerState.has(cbProvider)) {
      try {
        const state = await getProviderUsageState(cbProvider);
        const entry = state.entries.find((e: any) => e.providerId === cbProvider)
          ?? state.entries.find((e: any) => e.status === 'ok');
        providerState.set(cbProvider, entry ?? null);
      } catch {
        providerState.set(cbProvider, null);
      }
    }
  }

  return models.map((model): ScoredCandidate => {
    const state = providerState.get(mapProviderToCodexbar(model.provider));

    if (!state || state.status !== 'ok' || !state.metrics) {
      return { model, remaining: -1, primaryResetsAt: null, error: `Usage state unavailable for provider ${model.provider}` };
    }

    const metrics = state.metrics;
    const primaryPct = metrics.primary?.usedPercent ?? 0;
    const secondaryPct = metrics.secondary?.usedPercent ?? 0;
    const tertiaryPct = metrics.tertiary?.usedPercent ?? 0;
    const maxUsed = Math.max(primaryPct, secondaryPct, tertiaryPct);
    const remaining = 100 - maxUsed;
    const primaryResetsAt = metrics.primary?.resetsAt ?? null;

    return { model, remaining, primaryResetsAt };
  });
}

/**
 * Rank scored candidates by remaining budget (desc), then later primary reset (desc),
 * then alphabetical provider/id.
 */
export function rankScored(scored: ScoredCandidate[]): RankedResult {
  if (scored.length === 0) {
    return { error: 'all-unavailable' };
  }

  // Separate candidates with valid scores from those with errors
  const valid = scored.filter(s => !s.error);
  const errored = scored.filter(s => s.error);

  if (valid.length === 0) {
    // All candidates have usage errors — sort alphabetically as fallback
    const alphabetical = [...scored].sort((a, b) => {
      const aKey = `${a.model.provider}/${a.model.id}`;
      const bKey = `${b.model.provider}/${b.model.id}`;
      return aKey.localeCompare(bKey);
    });
    return { ordered: alphabetical };
  }
  const sorted = [...valid].sort((a, b) => {
    if (a.remaining !== b.remaining) {
      return b.remaining - a.remaining;
    }

    const aResets = a.primaryResetsAt ?? '';
    const bResets = b.primaryResetsAt ?? '';

    if (aResets !== bResets) {
      return bResets.localeCompare(aResets)
    };

    const aKey = `${a.model.provider}/${a.model.id}`;
    const bKey = `${b.model.provider}/${b.model.id}`;
    return aKey.localeCompare(bKey);
  });

  const erroredSorted = [...errored].sort((a, b) => {
    const aKey = `${a.model.provider}/${a.model.id}`;
    const bKey = `${b.model.provider}/${b.model.id}`;
    return aKey.localeCompare(bKey);
  });

  return { ordered: [...sorted, ...erroredSorted] };
}

/**
 * Format a human-readable dry-run preview of the ranking.
 */
export function formatDryRun(ordered: ScoredCandidate[]): string {
  const lines: string[] = ['📊 CodexBar Model Switch Preview', ''];

  if (ordered.length === 0) {
    lines.push('No candidates available.');
    return lines.join('\n');
  }

  lines.push('Ranked candidates:');
  for (let i = 0; i < ordered.length; i++) {
    const entry = ordered[i];
    const prefix = i === 0 ? '→' : ' ';
    if (entry.error) {
      lines.push(`  ${prefix} ${entry.model.provider}/${entry.model.id} — ⚠️ ${entry.error}`);
    } else {
      lines.push(`  ${prefix} ${entry.model.provider}/${entry.model.id} — ${entry.remaining}% remaining${entry.primaryResetsAt ? `, resets ${entry.primaryResetsAt}` : ''}`);
    }
  }

  return lines.join('\n');
}

function formatCandidateList(query: string, tier: ResolveTier, candidates: Model<any>[]): string {
  const heading = `📋 Candidates for "${query}" (tier: ${tier}):`;
  if (candidates.length === 0) {
    return `${heading}\n  (none)`;
  }
  return [heading, ...candidates.map(model => `  ${model.provider}/${model.id}`)].join('\n');
}

/**
 * Pure orchestrator: resolve candidates, score, rank, and produce a structured outcome.
 * No side effects — does not call pi.setModel or send notifications.
 */
export async function runSwitch(request: SwitchRequest, models: Model<any>[]): Promise<SwitchOutcome> {
  const { action, query, excludeProviders, dryRun } = request;
  const q = query?.trim() ?? '';

  if (action === 'list' && q.length === 0) {
    const exclude = new Set(excludeProviders ?? []);
    const candidates = exclude.size ? models.filter(m => !exclude.has(m.provider)) : models;
    return {
      kind: 'list',
      tier: 'registry',
      candidates,
      text: formatCandidateList(q, 'registry', candidates),
    };
  }

  const aliasResult = await loadAliases();
  const aliases = aliasResult.merged;

  const resolved = resolveCandidates(q, models, aliases, excludeProviders);

  if (resolved.tier === 'none' || resolved.candidates.length === 0) {
    return { kind: 'error', message: `No candidates found for "${q}"${resolved.unknownKey ? ` (unknown key: ${resolved.unknownKey})` : ''}` };
  }

  // Score candidates
  const scored = await scoreCandidates(resolved.candidates);
  const ranked = rankScored(scored);

  if (action === 'list') {
    return {
      kind: 'list',
      tier: resolved.tier,
      candidates: resolved.candidates,
      text: formatCandidateList(q, resolved.tier, resolved.candidates),
    };
  }

  // action === 'switch'
  if ('error' in ranked) {
    return { kind: 'error', message: 'All candidates are unavailable' };
  }

  const winner = ranked.ordered[0].model;

  if (dryRun) {
    const text = formatDryRun(ranked.ordered);
    return { kind: 'preview', text, winner, ordered: ranked.ordered };
  }

  return { kind: 'switch', winner, ordered: ranked.ordered };
}

export function parseSlashArgs(raw: string): ParsedSlashArgs {
  const tokens = raw.trim().split(/\s+/).filter(token => token.length > 0);

  let action: 'switch' | 'list' = 'switch';
  let dryRun = false;
  const excludeProviders: string[] = [];
  const positional: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (i === 0 && (token === 'list' || token === 'switch')) {
      action = token;
      continue;
    }
    if (token === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (token.startsWith('--exclude=')) {
      const value = token.slice('--exclude='.length);
      const providers = value.split(',').map(p => p.trim()).filter(p => p.length > 0);
      if (providers.length === 0) {
        return { error: 'Missing provider in --exclude=<provider>[,<provider>...]' };
      }
      excludeProviders.push(...providers);
      continue;
    }
    if (token.startsWith('--')) {
      return { error: `Unknown flag: ${token}` };
    }
    positional.push(token);
  }

  if (action === 'switch' && positional.length === 0) {
    return { error: 'Missing query: provide a model name, alias, or built-in key' };
  }

  return {
    action,
    query: positional.join(' ') || undefined,
    excludeProviders,
    dryRun,
  };
}
