import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { fulfillCheckout, revokeForRefund } from "@/lib/fulfillment";
import { createAdminClient } from "@/lib/supabase/admin";

// Reconciliation uses the stored service-role event row as its retry source and does not
// keep a second copy of the raw request body or signature.
export const STRIPE_EVENT_LEASE_SECONDS = 15 * 60;
export const STRIPE_RECONCILE_BATCH_SIZE = 50;

type ClaimResult = {
  status: "claimed" | "busy" | "terminal";
  outcome?: string;
  attempt_count: number;
  payload: Stripe.Event;
};

export type ProcessResult =
  | { status: "processed"; outcome: string; attemptCount: number }
  | { status: "busy"; attemptCount: number }
  | { status: "terminal"; outcome: string; attemptCount: number }
  | { status: "lease-lost"; attemptCount: number };

function eventDate(event: Stripe.Event): string {
  return new Date(event.created * 1_000).toISOString();
}

async function claimEvent(event: Stripe.Event, token: string, leaseSeconds: number): Promise<ClaimResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_stripe_event", {
    p_id: event.id,
    p_type: event.type,
    p_event_created: eventDate(event),
    p_payload: event,
    p_token: token,
    p_lease_seconds: leaseSeconds,
  });
  if (error || !data) throw error ?? new Error("Stripe event claim returned no result");
  return data as ClaimResult;
}

async function finalizeEvent(id: string, token: string, outcome: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("finalize_stripe_event", {
    p_id: id,
    p_token: token,
    p_outcome: outcome,
  });
  if (error) throw error;
  return data === true;
}

async function eventOutcome(event: Stripe.Event, stripe: Stripe, enforceFreshness: boolean): Promise<string> {
  if (enforceFreshness && Date.now() / 1_000 - event.created > 7 * 24 * 60 * 60) {
    return "ignored-stale";
  }
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (!session.metadata?.play) return "ignored-non-plays-checkout";
    return fulfillCheckout(session);
  }
  if (event.type === "charge.refunded") {
    return revokeForRefund(stripe, event.data.object as Stripe.Charge);
  }
  return "ignored";
}

export async function processVerifiedStripeEvent(
  event: Stripe.Event,
  stripe: Stripe,
  options: { enforceFreshness: boolean; leaseSeconds?: number } = { enforceFreshness: true },
): Promise<ProcessResult> {
  const token = randomUUID();
  const claim = await claimEvent(event, token, options.leaseSeconds ?? STRIPE_EVENT_LEASE_SECONDS);
  if (claim.status === "busy") return { status: "busy", attemptCount: claim.attempt_count };
  if (claim.status === "terminal") {
    return { status: "terminal", outcome: claim.outcome ?? "unknown", attemptCount: claim.attempt_count };
  }

  try {
    const outcome = await eventOutcome(claim.payload, stripe, options.enforceFreshness);
    if (!await finalizeEvent(event.id, token, outcome)) {
      return { status: "lease-lost", attemptCount: claim.attempt_count };
    }
    return { status: "processed", outcome, attemptCount: claim.attempt_count };
  } catch (error) {
    try {
      await finalizeEvent(event.id, token, "failed");
    } catch (finalizeError) {
      console.error("Stripe event failure could not be finalized", finalizeError instanceof Error ? finalizeError.message : "unknown");
    }
    throw error;
  }
}

type StoredEventRow = {
  id: string;
  payload: Stripe.Event;
};

export async function reconcileStaleStripeEvents(leaseSeconds = STRIPE_EVENT_LEASE_SECONDS) {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - leaseSeconds * 1_000).toISOString();
  const { data, error } = await admin
    .from("stripe_events")
    .select("id,payload")
    .eq("outcome", "processing")
    .lte("processing_started_at", cutoff)
    .order("processing_started_at", { ascending: true })
    .limit(STRIPE_RECONCILE_BATCH_SIZE + 1);
  if (error) throw error;

  const rows = (data ?? []) as StoredEventRow[];
  const capped = rows.length > STRIPE_RECONCILE_BATCH_SIZE;
  if (capped) {
    console.warn(`Stripe reconciler batch cap hit: at least ${rows.length} stale rows, limit ${STRIPE_RECONCILE_BATCH_SIZE}`);
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const summary = { scanned: Math.min(rows.length, STRIPE_RECONCILE_BATCH_SIZE), completed: 0, failed: 0, busy: 0, capped };
  for (const row of rows.slice(0, STRIPE_RECONCILE_BATCH_SIZE)) {
    try {
      const result = await processVerifiedStripeEvent(row.payload, stripe, { enforceFreshness: false, leaseSeconds });
      if (result.status === "processed" || result.status === "terminal") summary.completed += 1;
      else summary.busy += 1;
    } catch (error) {
      summary.failed += 1;
      console.error("Stripe reconciliation failed", row.id, error instanceof Error ? error.message : "unknown");
    }
  }
  return summary;
}
