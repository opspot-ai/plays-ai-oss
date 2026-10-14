import { NextResponse } from "next/server";
import Stripe from "stripe";
import { assertFulfillmentEnv } from "@/lib/env";
import { processVerifiedStripeEvent } from "@/lib/stripe-events";

export const runtime = "nodejs";

export async function POST(request: Request) {
  assertFulfillmentEnv();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });

  const raw = await request.text();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }

  try {
    const result = await processVerifiedStripeEvent(event, stripe, { enforceFreshness: true });
    if (result.status === "terminal") {
      return NextResponse.json({ received: true, duplicate: true, outcome: result.outcome });
    }
    if (result.status === "busy" || result.status === "lease-lost") {
      return NextResponse.json(
        { error: "Event processing is still in progress." },
        { status: 503, headers: { "retry-after": "60" } },
      );
    }
    return NextResponse.json({ received: true, outcome: result.outcome });
  } catch (error) {
    console.error("Stripe fulfillment failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Fulfillment failed safely." }, { status: 500 });
  }
}
