import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { assertFulfillmentEnv, fulfillmentEnabled } from "@/lib/env";
import { getPlay } from "@/lib/plays";
import { createAdminClient } from "@/lib/supabase/admin";
import { createUserClient } from "@/lib/supabase/server";

// Creates a Stripe Checkout session for a play.
// Key-gated: with no STRIPE_SECRET_KEY the route responds {configured:false}
// so the whole flow works in preview — adding the key is the only step to go live.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const play = getPlay(slug);
  if (!play) {
    return NextResponse.json({ error: "Unknown play." }, { status: 404 });
  }
  if (play.availability !== "available") {
    return NextResponse.json({ error: "This play is on the roster, not for sale yet." }, { status: 409 });
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!fulfillmentEnabled() || !key) {
    return NextResponse.json({ configured: false, play: play.slug });
  }
  assertFulfillmentEnv();

  // Already-owned guard: a signed-in buyer who owns this play gets pointed at their roster
  // instead of a second charge. Best-effort and fail-open: anonymous buyers pass through
  // (fulfillment already dedupes the entitlement), and no error here may ever block a sale.
  try {
    const { data: { user } } = await (await createUserClient()).auth.getUser();
    const email = user?.email?.trim().toLowerCase();
    if (email) {
      const admin = createAdminClient();
      const { data: account } = await admin.from("accounts").select("id").eq("email", email).maybeSingle();
      if (account) {
        const { data: owned } = await admin
          .from("entitlements")
          .select("id,status")
          .eq("account_id", account.id)
          .eq("sku", play.slug)
          .maybeSingle();
        if (owned?.status === "active") {
          return NextResponse.json({ alreadyOwned: true, play: play.slug });
        }
      }
    }
  } catch {
    // fall through to checkout
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(key);
    const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:4720";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: randomUUID(),
      customer_creation: "always",
      custom_fields: [
        {
          key: "organization",
          label: { type: "custom", custom: "Organization name" },
          type: "text",
          optional: false,
        },
      ],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: play.price * 100,
            product_data: { name: `${play.name} — Plays`, description: play.tagline },
          },
        },
      ],
      success_url: `${base}/success?play=${play.slug}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/plays/${play.slug}`,
      metadata: {
        play: play.slug,
        bundle_version: play.bundleVersion ?? "",
        bundle_sha256: play.tarballSha256 ?? "",
      },
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Checkout failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
