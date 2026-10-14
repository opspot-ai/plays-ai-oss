import { createHash, randomBytes } from "node:crypto";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlay } from "@/lib/plays";

export function hashLicense(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function organization(session: Stripe.Checkout.Session): string {
  const field = session.custom_fields?.find((item) => item.key === "organization");
  const value = field?.text?.value?.trim();
  return value || session.customer_details?.name?.trim() || "Purchasing organization";
}

async function ensureAuthUser(email: string): Promise<string> {
  const admin = createAdminClient();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found.id;
    if (data.users.length < 100) break;
  }
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("Supabase did not create the buyer");
  return data.user.id;
}

async function sendMagicLink(email: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/library`,
      shouldCreateUser: false,
    },
  });
  if (error && error.status !== 429) {
    console.warn("Entitlement created, but the library sign-in email must be requested separately.");
  }
}

export async function fulfillCheckout(
  session: Stripe.Checkout.Session,
): Promise<"created" | "existing" | "existing-duplicate-charge" | "repaired-existing"> {
  const email = session.customer_details?.email?.trim().toLowerCase() || session.customer_email?.trim().toLowerCase();
  const slug = session.metadata?.play;
  const play = slug ? getPlay(slug) : undefined;
  if (!email) throw new Error("checkout session has no buyer email");
  if (!play || play.availability !== "available" || !play.bundleVersion || !play.tarballSha256) {
    throw new Error(`checkout session has no fulfillable play: ${slug || "missing"}`);
  }

  const admin = createAdminClient();
  const userId = await ensureAuthUser(email);
  const { data: account, error: accountError } = await admin
    .from("accounts")
    .upsert({ email, user_id: userId, updated_at: new Date().toISOString() }, { onConflict: "email" })
    .select("id")
    .single();
  if (accountError || !account) throw accountError ?? new Error("account upsert returned no row");

  const mode = process.env.STRIPE_MODE === "live" ? "live" : "test";
  const licenseKey = `pk_${mode}_${randomBytes(24).toString("base64url")}`;
  const versionCeiling = new Date();
  versionCeiling.setUTCFullYear(versionCeiling.getUTCFullYear() + 1);
  const { data, error } = await admin.rpc("grant_play_entitlement_atomic", {
    p_account_id: account.id,
    p_sku: play.slug,
    p_license_key: licenseKey,
    p_license_key_hash: hashLicense(licenseKey),
    p_bundle_version: play.bundleVersion,
    p_bundle_sha256: play.tarballSha256,
    p_version_ceiling: versionCeiling.toISOString(),
    p_grant: "single-org-source-visible",
    p_org_name: organization(session),
    p_stripe_session_id: session.id,
  });
  if (error || !data) throw error ?? new Error("atomic entitlement grant returned no result");
  const grantResult = data as { outcome?: string; stripe_session_id?: string | null };
  const outcome = grantResult.outcome;
  if (outcome !== "created" && outcome !== "existing" && outcome !== "repaired-existing") {
    throw new Error(`atomic entitlement grant returned invalid outcome: ${outcome ?? "missing"}`);
  }
  // The RPC serializes concurrent grants. Only the worker that creates a complete pair, or
  // repairs the pre-transaction entitlement-without-license state, owns the buyer notification.
  // Replays and distinct duplicate charges return `existing` and must not re-mail credentials.
  if (outcome === "created" || outcome === "repaired-existing") {
    await sendMagicLink(email);
  }
  if (
    outcome === "existing"
    && grantResult.stripe_session_id !== session.id
    && (session.amount_total ?? 0) > 0
  ) {
    // Distinct ledger outcome when money actually moved again: an anonymous buyer paid a
    // second time for a play they already own. No new entitlement is created; these
    // stripe_events rows are the refund-candidate queue. Issuing the refund stays a human decision.
    return "existing-duplicate-charge";
  }
  return outcome;
}

// Revokes an entitlement after a full refund.
//
// This blocks FUTURE installs only. Already-installed copies keep working forever, because
// entitlement is checked at install and never at run. That is the no-phone-home promise, and
// it is deliberate: a refund takes back the right to install again, not the buyer's machine.
export async function revokeForRefund(stripe: Stripe, charge: Stripe.Charge): Promise<string> {
  // Partial refunds leave the purchase standing. Only a full refund revokes.
  if (charge.amount_refunded < charge.amount) return "ignored-partial-refund";

  const paymentIntent =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntent) return "ignored-no-payment-intent";

  const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntent, limit: 1 });
  const sessionId = sessions.data[0]?.id;
  if (!sessionId) return "ignored-no-session";

  const admin = createAdminClient();
  const { data: entitlement, error } = await admin
    .from("entitlements")
    .select("id")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  if (error) throw error;
  if (!entitlement) return "ignored-no-entitlement";

  // "revoked" is the value the entitlements and licenses CHECK constraints allow
  // (active | revoked | chargeback). Writing anything outside that set raises 23514,
  // the webhook records outcome "failed", and the buyer stays entitled forever.
  const { error: entError } = await admin
    .from("entitlements")
    .update({ status: "revoked" })
    .eq("id", entitlement.id);
  if (entError) throw entError;
  const { error: licError } = await admin
    .from("licenses")
    .update({ status: "revoked" })
    .eq("entitlement_id", entitlement.id);
  if (licError) throw licError;
  return "revoked";
}

export type ActiveLicense = {
  id: string;
  ordering_salt: string;
  entitlement: {
    id: string;
    account_id: string;
    sku: string;
    bundle_version: string;
    bundle_sha256: string;
    status: string;
    license_key: string;
  };
};

export async function activeLicense(raw: string): Promise<ActiveLicense | null> {
  if (!raw) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("licenses")
    .select("id,status,ordering_salt,entitlement:entitlements!inner(id,account_id,sku,bundle_version,bundle_sha256,status,license_key)")
    .eq("key_hash", hashLicense(raw))
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as ActiveLicense & { status: string };
  if (row.status !== "active" || row.entitlement.status !== "active") return null;
  return { id: row.id, ordering_salt: row.ordering_salt, entitlement: row.entitlement };
}
