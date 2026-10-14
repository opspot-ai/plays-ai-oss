import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STRIPE_EVENT_LEASE_SECONDS } from "../stripe-events";

const MAX_RECOVERY_SECONDS = 20 * 60;

describe("Stripe event recovery contract", () => {
  it("keeps the production cron cadence inside the documented 20-minute recovery bound", () => {
    const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as {
      crons?: Array<{ path?: string; schedule?: string }>;
    };
    const cron = vercel.crons?.find(({ path }) => path === "/api/internal/reconcile-stripe-events");
    expect(cron).toBeDefined();

    const cadence = /^\*\/([1-9]\d*) \* \* \* \*$/.exec(cron!.schedule ?? "");
    expect(cadence).not.toBeNull();
    const cadenceSeconds = Number(cadence![1]) * 60;
    expect(STRIPE_EVENT_LEASE_SECONDS + cadenceSeconds).toBeLessThanOrEqual(MAX_RECOVERY_SECONDS);
  });
});
