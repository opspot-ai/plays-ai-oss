import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { reconcileStaleStripeEvents } from "@/lib/stripe-events";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const value = request.headers.get("authorization");
  if (!secret || !value?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(value.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    return NextResponse.json(await reconcileStaleStripeEvents());
  } catch (error) {
    console.error("Stripe reconciliation run failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Reconciliation failed." }, { status: 500 });
  }
}
