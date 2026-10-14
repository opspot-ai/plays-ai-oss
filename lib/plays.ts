import catalog from "./catalog.generated.json";

export type Category =
  | "Sales & Leads"
  | "Inbound & Follow-up"
  | "Setup & Delivery"
  | "Ops & Self-healing"
  | "Content & Presence"
  | "Research";

export type Play = {
  slug: string;
  name: string;
  tagline: string;
  category: Category;
  price: number;
  availability: "available";
  bundleVersion: string;
  tarballSha256: string;
  flagship: boolean;
  summary: string;
  whatYouGet: string[];
  toolsNeeded: string[];
  outcome: string;
  teamSize: number;
  sampleOutput: string;
  safety: string[];
};

export const CATEGORIES: Category[] = [
  "Sales & Leads",
  "Inbound & Follow-up",
  "Setup & Delivery",
  "Ops & Self-healing",
  "Content & Presence",
  "Research",
];

// Every old public URL keeps working: /plays/<alias> redirects to /plays/<canonical>.
// Canonical slugs are listed in the generated catalog below.
export const ALIASES: Record<string, string> = {
  "cold-outreach-conveyor": "post-audit-sales-intro",
  "cold-sms-lane": "toll-free-cold-sms-outbound",
  "missed-call-voice-answer": "missed-call-ai-answer",
  "inbound-auto-reply": "unified-inbound-reply",
  "speed-to-lead-review": "customer-follow-up-machine",
  "onboarding-factory": "customer-setup-factory",
  "client-auto-repair": "client-health-auto-repair",
  "feedback-flywheel": "feedback-improvement-loop",
  // Renamed by the 2026-07-30 plays triage, old storefront URLs preserved.
  "high-value-sale-follow-up": "customer-follow-up-machine",
  "service-health-auto-repair": "client-health-auto-repair",
  "customer-context-hydration-and-logging": "customer-hydration-logging",
  "missed-call-ai-voice-answer": "missed-call-ai-answer",
};

export const PLAYS = catalog as Play[];

export function canonicalPlaySlug(slug: string): string {
  return ALIASES[slug] ?? slug;
}

export function getPlay(slug: string): Play | undefined {
  const canonical = canonicalPlaySlug(slug);
  return PLAYS.find((play) => play.slug === canonical);
}

export function playsByCategory(category: Category): Play[] {
  return PLAYS.filter((play) => play.category === category);
}

export function formatPrice(usd: number): string {
  return `$${usd.toLocaleString("en-US")}`;
}
