import { readFileSync } from "node:fs";
import path from "node:path";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression guard for the refund that never revoked.
//
// `revokeForRefund` used to write status "refunded", which is NOT in the CHECK constraint
// on either table. Postgres raised 23514, the webhook recorded outcome "failed" and returned
// 500, Stripe retried into the same wall forever, and the refunded buyer kept a live license.
//
// This test does not hardcode the allowed set. It reads it out of the migration that owns the
// constraint, so the test tracks the schema instead of restating the fix.

const MIGRATION = path.join(__dirname, "..", "..", "supabase", "migrations", "20260727000100_fulfillment.sql");

function allowedStatuses(table: string): string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const body = sql.split(`create table public.${table} (`)[1]?.split("\n);")[0];
  if (!body) throw new Error(`migration has no create table for ${table}`);
  const check = /status[^,]*check \(status in \(([^)]*)\)\)/.exec(body);
  if (!check) throw new Error(`migration has no status CHECK constraint on ${table}`);
  return check[1].split(",").map((value) => value.trim().replace(/^'|'$/g, ""));
}

// Stands in for Postgres: accepts a status the CHECK constraint allows, and rejects
// anything else with the same 23514 the real database raises.
const writes: { table: string; status: string }[] = [];

function checkedAdminClient() {
  const entitlementId = "ent_00000000";
  return {
    from(table: string) {
      const builder = {
        select: () => builder,
        update(values: { status: string }) {
          writes.push({ table, status: values.status });
          const rejected = !allowedStatuses(table).includes(values.status);
          const result = rejected
            ? { data: null, error: { code: "23514", message: `new row for relation "${table}" violates check constraint "${table}_status_check"` } }
            : { data: null, error: null };
          return { eq: () => Promise.resolve(result) };
        },
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: { id: entitlementId }, error: null }),
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => checkedAdminClient() }));

const { revokeForRefund } = await import("../fulfillment");

const stripe = {
  checkout: { sessions: { list: async () => ({ data: [{ id: "cs_test_refund_fixture" }] }) } },
} as unknown as Stripe;

const fullyRefundedCharge = {
  amount: 24_900,
  amount_refunded: 24_900,
  payment_intent: "pi_test_refund_fixture",
} as unknown as Stripe.Charge;

describe("revokeForRefund", () => {
  beforeEach(() => {
    writes.length = 0;
  });

  it("writes a status both CHECK constraints accept, on entitlements and on licenses", async () => {
    const outcome = await revokeForRefund(stripe, fullyRefundedCharge);

    expect(outcome).toBe("revoked");
    expect(writes.map(({ table }) => table)).toEqual(["entitlements", "licenses"]);
    for (const write of writes) {
      expect(allowedStatuses(write.table)).toContain(write.status);
    }
  });

  it("takes the license away rather than leaving it active", async () => {
    await revokeForRefund(stripe, fullyRefundedCharge);

    // activeLicense() only returns a license while both rows read "active". Any other
    // allowed value would satisfy the constraint yet still have to deny the buyer.
    for (const write of writes) {
      expect(write.status).not.toBe("active");
    }
  });

  it("leaves a partial refund alone", async () => {
    const partial = { ...fullyRefundedCharge, amount_refunded: 1_000 } as unknown as Stripe.Charge;

    expect(await revokeForRefund(stripe, partial)).toBe("ignored-partial-refund");
    expect(writes).toEqual([]);
  });
});
