const REQUIRED_FULFILLMENT_ENV = [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "DEVICE_CODE_SECRET",
  "BUNDLE_STORAGE_BUCKET",
] as const;

export function assertFulfillmentEnv(): void {
  if (process.env.FULFILLMENT_ENABLED !== "true") return;
  const missing = REQUIRED_FULFILLMENT_ENV.filter((key) => !process.env[key]?.trim());
  if (missing.length) throw new Error(`Fulfillment is enabled but env is missing: ${missing.join(", ")}`);
  const mode = process.env.STRIPE_MODE ?? "test";
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  // Restricted keys (rk_) are the preferred production credential: scoped and non-expiring.
  // The guard exists to keep test credentials out of live mode, not to require an unrestricted key.
  const matchesMode = (m: string) => key.startsWith(`sk_${m}_`) || key.startsWith(`rk_${m}_`);
  if (mode === "test" && !matchesMode("test")) throw new Error("STRIPE_MODE=test requires sk_test_ or rk_test_ credentials");
  if (mode === "live" && !matchesMode("live")) throw new Error("STRIPE_MODE=live requires sk_live_ or rk_live_ credentials");
}

export function fulfillmentEnabled(): boolean {
  return process.env.FULFILLMENT_ENABLED === "true";
}
