import type { PlayManifest, PlaysConfig, Provider, RoutingStep } from "./types.js";

export interface Resolution {
  provider: Provider | null;
  warning?: string;
}

function providers(config: PlaysConfig): Provider[] {
  return config.routing.order
    .filter((name) => config.providers[name])
    .map((name) => ({ name, ...config.providers[name] }));
}

function satisfies(provider: Provider, step: RoutingStep): boolean {
  if (provider.exhausted || !provider.tiers.includes(step.tier)) return false;
  if (provider.reserve_for?.length && !provider.reserve_for.includes(step.tier)) return false;
  const capabilities = new Set(provider.needs ?? []);
  return (step.needs ?? []).every((need) => capabilities.has(need));
}

function zeroMarginal(provider: Provider): boolean {
  return provider.kind === "subscription" || (provider.cost_per_1k ?? 0) === 0;
}

export function resolveProvider(
  step: RoutingStep,
  config: PlaysConfig,
  selectedByStep: Record<string, string> = {},
  excluded = new Set<string>(),
): Resolution {
  let candidates = providers(config).filter((provider) => satisfies(provider, step) && !excluded.has(provider.name));
  if (step.must_differ_from && selectedByStep[step.must_differ_from]) {
    const reviewedProvider = selectedByStep[step.must_differ_from];
    const different = candidates.filter((provider) => provider.name !== reviewedProvider);
    if (different.length) candidates = different;
    else {
      const fallback = candidates[0] ?? null;
      return {
        provider: fallback,
        warning: fallback ? `no second provider for ${step.step}; proceeding with ${fallback.name}` : undefined,
      };
    }
  }
  candidates = candidates
    .map((provider, index) => ({ provider, index }))
    .sort((a, b) => Number(zeroMarginal(b.provider)) - Number(zeroMarginal(a.provider)) || a.index - b.index)
    .map(({ provider }) => provider);
  return { provider: candidates[0] ?? null };
}

export function nextTier(manifest: PlayManifest, tier: string): string | null {
  const tiers = Object.keys(manifest.models.tiers);
  const index = tiers.indexOf(tier);
  return index >= 0 && index + 1 < tiers.length ? tiers[index + 1] : null;
}

export function providerMarginalUsd(provider: Provider, tokens: number): number {
  if (provider.kind === "subscription") return 0;
  return (tokens / 1_000) * (provider.cost_per_1k ?? 0);
}

export function planRoute(manifest: PlayManifest, config: PlaysConfig): Array<{
  step: RoutingStep;
  provider: Provider | null;
  warning?: string;
  marginalUsd: number;
}> {
  const selected: Record<string, string> = {};
  return manifest.routing.map((step) => {
    if (step.tier === "none") return { step, provider: null, marginalUsd: 0 };
    const resolution = resolveProvider(step, config, selected);
    if (resolution.provider) selected[step.step] = resolution.provider.name;
    return {
      step,
      provider: resolution.provider,
      warning: resolution.warning,
      marginalUsd: resolution.provider ? providerMarginalUsd(resolution.provider, step.est_tokens ?? 0) : 0,
    };
  });
}

export function frontierEquivalent(manifest: PlayManifest): number {
  const tokens = manifest.routing.reduce((sum, step) => sum + (step.est_tokens ?? 0), 0);
  return Number(((tokens / 1_000) * 0.03).toFixed(4));
}
