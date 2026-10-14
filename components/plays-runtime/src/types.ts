export type Tier = string;
export type Position =
  | "quarterback"
  | "center"
  | "lineman"
  | "running-back"
  | "wide-receiver"
  | "tight-end"
  | "linebacker"
  | "safety"
  | "kicker";

export interface ToolRequirement {
  id: string;
  why: string;
  binding: {
    kind: "any-of" | "builtin" | "mcp" | "executable";
    suggest?: string[];
    path_scope?: string;
    command?: string;
  };
  optional?: boolean;
  degrade?: string;
}

export interface SecretRequirement {
  key: string;
  scope?: string;
  optional?: boolean;
  resolver: string[];
}

export interface RoutingStep {
  step: string;
  player: string;
  tier: Tier;
  needs?: string[];
  est_tokens?: number;
  validate?: string;
  must_differ_from?: string;
  deterministic?: string;
  gated_by?: string;
  decision?: string;
}

export interface PlayManifest {
  spec: "playbundle/v2";
  play: string;
  version: string;
  name: string;
  outcome: string;
  team: "team.yaml";
  license: { sku: string; grant: string; updates_until: string | null };
  loop: {
    entrypoint: string;
    max_steps_per_run: number;
    resume_from: string;
    stop_conditions: string[];
  };
  requires: {
    tools: ToolRequirement[];
    secrets: SecretRequirement[];
    data: Array<{ id: string; path: string; mode: string; default: string }>;
    caps: Array<{ id: string; default: number; unit?: string }>;
  };
  models: {
    tiers: Record<string, { needs: string[]; min_context: number }>;
    policy: { subscription_first: boolean; escalate_on_invalid: boolean };
  };
  routing: RoutingStep[];
  receipts: { dir: string };
}

export interface PlayerManifest {
  spec: "playplayer/v1";
  id: string;
  name: string;
  mission: string;
  capabilities: string[];
  boundaries: string[];
  memory_policy: string;
  tool_needs: string[];
  model_requirements: string[];
}

export interface TeamMember {
  player: string;
  position: Position;
  assignment: string;
  steps: string[];
}

export interface Handoff {
  id: string;
  from: string;
  to: string;
  artifact: string;
  schema?: string;
}

export interface TeamManifest {
  spec: "playteam/v1";
  name: string;
  quarterback: string;
  lineup: TeamMember[];
  handoffs: Handoff[];
}

export interface LoadedTeam {
  team: TeamManifest;
  players: Record<string, { manifest: PlayerManifest; instructions: string }>;
}

export interface Provider {
  name: string;
  kind: "endpoint" | "subscription";
  base_url?: string;
  model?: string;
  exec?: "claude -p" | "codex exec" | string;
  tiers: string[];
  needs?: string[];
  cost_per_1k?: number;
  window?: string;
  concurrency?: number;
  reserve_for?: string[];
  exhausted?: boolean;
}

export interface PlaysConfig {
  providers: Record<string, Omit<Provider, "name">>;
  routing: {
    order: string[];
    spillover: boolean;
    on_all_exhausted: "pause-and-resume";
  };
  caps?: Record<string, number>;
}

export interface StepReceipt {
  step: string;
  player: string;
  position: Position;
  provider: string;
  tier: string;
  tokens: number;
  marginalUsd: number;
  attempt: number;
  outcome: "completed" | "invalid" | "exhausted" | "failed" | "skipped";
  escalatedFrom?: string;
}

export interface RunReceipt {
  runId: string;
  play: string;
  team: string;
  startedAt: string;
  finishedAt: string;
  outcome: "completed" | "paused" | "failed";
  steps: StepReceipt[];
  providersUsed: string[];
  marginalUsd: number;
  allFrontierApiEquivalentUsd: number;
  savingsUsd: number;
  cursor: number;
  reason?: string;
}
