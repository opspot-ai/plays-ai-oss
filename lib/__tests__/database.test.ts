import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres, { type Sql } from "postgres";
import Stripe from "stripe";
import { activeLicense, fulfillCheckout, hashLicense, revokeForRefund } from "../fulfillment";
import { PLAYS } from "../plays";
import runtimeRelease from "../runtime-release.generated.json";
import { reconcileStaleStripeEvents, STRIPE_EVENT_LEASE_SECONDS } from "../stripe-events";
import { createAdminClient } from "../supabase/admin";
import { GET as download } from "../../app/api/download/route";
import { GET as reconcile } from "../../app/api/internal/reconcile-stripe-events/route";
import { POST as webhook } from "../../app/api/stripe/webhook/route";

const databaseUrl = process.env.TEST_DATABASE_URL!;

function checkoutEvent(options: {
  id: string;
  email?: string;
  play?: string | null;
  sessionId?: string;
  amountTotal?: number;
}): Stripe.Event {
  const metadata = options.play === null ? {} : { play: options.play ?? "lead-bank-engine" };
  return {
    id: options.id,
    object: "event",
    api_version: "2025-02-24.acacia",
    created: Math.floor(Date.now() / 1_000),
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "checkout.session.completed",
    data: {
      object: {
        id: options.sessionId ?? `cs_test_${randomUUID()}`,
        object: "checkout.session",
        amount_total: options.amountTotal ?? 49_900,
        customer_details: { email: options.email, name: "Webhook Fixture" },
        metadata,
      },
    },
  } as unknown as Stripe.Event;
}

function signedRequest(event: Stripe.Event): Request {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  });
  return new Request("http://example.com/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: payload,
  });
}

function verifiedEvent(event: Stripe.Event): Stripe.Event {
  const request = signedRequest(event);
  const payload = JSON.stringify(event);
  return Stripe.webhooks.constructEvent(
    payload,
    request.headers.get("stripe-signature")!,
    process.env.STRIPE_WEBHOOK_SECRET!,
  );
}

describe("fulfillment database", () => {
  let sql: Sql;
  const firstUser = randomUUID();
  const secondUser = randomUUID();
  const firstAccount = randomUUID();
  const secondAccount = randomUUID();
  const eventId = `evt_fixture_${randomUUID()}`;
  const webhookEventId = `evt_fixture_${randomUUID()}`;
  const fencingEventId = `evt_fencing_${randomUUID()}`;
  const crashEventId = `evt_crash_${randomUUID()}`;
  const freshEventId = `evt_fresh_${randomUUID()}`;
  const orphanEventId = `evt_orphan_${randomUUID()}`;
  const foreignEventId = `evt_foreign_${randomUUID()}`;
  const unknownEventId = `evt_unknown_${randomUUID()}`;
  const missingBuyerEventId = `evt_missing_buyer_${randomUUID()}`;
  const cappedEventIds = Array.from({ length: 51 }, () => `evt_cap_${randomUUID()}`);
  const webhookBuyerEmail = `webhook-${randomUUID()}@example.invalid`;
  const atomicBuyerEmail = `atomic-${randomUUID()}@example.invalid`;
  const crashBuyerEmail = `crash-${randomUUID()}@example.invalid`;
  const freshBuyerEmail = `fresh-${randomUUID()}@example.invalid`;
  const orphanBuyerEmail = `orphan-${randomUUID()}@example.invalid`;
  const foreignBuyerEmail = `foreign-${randomUUID()}@example.invalid`;
  const unknownBuyerEmail = `unknown-${randomUUID()}@example.invalid`;
  const refundBuyerEmail = `refund-${randomUUID()}@example.invalid`;
  const latencyBuyerEmails = PLAYS.map((play) => `latency-${play.slug}-${randomUUID()}@example.invalid`);
  const eventIds = [
    eventId,
    webhookEventId,
    fencingEventId,
    crashEventId,
    freshEventId,
    orphanEventId,
    foreignEventId,
    unknownEventId,
    missingBuyerEventId,
    ...cappedEventIds,
  ];
  const generatedEmails = [
    webhookBuyerEmail,
    atomicBuyerEmail,
    crashBuyerEmail,
    freshBuyerEmail,
    orphanBuyerEmail,
    foreignBuyerEmail,
    unknownBuyerEmail,
    refundBuyerEmail,
    ...latencyBuyerEmails,
  ];

  beforeAll(async () => {
    process.env.FULFILLMENT_ENABLED = "true";
    process.env.STRIPE_MODE = "test";
    process.env.STRIPE_SECRET_KEY ||= "sk_test_fixture";
    process.env.STRIPE_WEBHOOK_SECRET ||= "whsec_fixture";
    process.env.DEVICE_CODE_SECRET ||= "device-code-fixture";
    process.env.BUNDLE_STORAGE_BUCKET ||= "paid-bundles";
    process.env.NEXT_PUBLIC_SITE_URL ||= "http://127.0.0.1:4720";
    process.env.DOWNLOADS_PER_HOUR = "100";
    writeFileSync(process.env.TEST_FULFILLMENT_EMAIL_EXPECTATIONS_PATH!, JSON.stringify({
      recipients: Object.fromEntries([
        ...latencyBuyerEmails,
        refundBuyerEmail,
        webhookBuyerEmail,
        crashBuyerEmail,
        orphanBuyerEmail,
      ].map((email) => [email, 1])),
    }));
    sql = postgres(databaseUrl, { max: 1 });
    for (const [id, email] of [[firstUser, `first-${firstUser}@example.invalid`], [secondUser, `second-${secondUser}@example.invalid`]]) {
      await sql`
        insert into auth.users (
          instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
          confirmation_token, email_change, email_change_token_new, recovery_token
        ) values (
          '00000000-0000-4000-8000-000000000001', ${id}, 'authenticated', 'authenticated',
          ${email}, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(),
          '', '', '', ''
        )
      `;
    }
    await sql`insert into public.accounts (id, user_id, email) values (${firstAccount}, ${firstUser}, ${`first-${firstUser}@example.invalid`})`;
    await sql`insert into public.accounts (id, user_id, email) values (${secondAccount}, ${secondUser}, ${`second-${secondUser}@example.invalid`})`;
  });

  afterAll(async () => {
    for (const id of eventIds) await sql`delete from public.stripe_events where id = ${id}`;
    for (const email of generatedEmails) await sql`delete from auth.users where email = ${email}`;
    await sql`delete from auth.users where id in (${firstUser}, ${secondUser})`;
    await sql.end();
  });

  it("RLS returns only the authenticated account and refuses Stripe ledger authority", async () => {
    const rows = await sql.begin(async (transaction) => {
      await transaction.unsafe("set local role authenticated");
      await transaction`select set_config('request.jwt.claim.sub', ${firstUser}, true)`;
      return transaction`select id from public.accounts order by id`;
    });
    expect(rows.map(({ id }) => id)).toEqual([firstAccount]);

    for (const role of ["anon", "authenticated"]) {
      const deniedEvent = checkoutEvent({ id: `evt_denied_${randomUUID()}`, email: "buyer@example.com" });
      await expect(sql.begin(async (transaction) => {
        await transaction.unsafe(`set local role ${role}`);
        await transaction`insert into public.stripe_events (id, type, event_created, payload)
          values (${deniedEvent.id}, ${deniedEvent.type}, now(), ${transaction.json(deniedEvent as never)})`;
      })).rejects.toThrow();
      await expect(sql.begin(async (transaction) => {
        await transaction.unsafe(`set local role ${role}`);
        await transaction`select public.claim_stripe_event(
          ${deniedEvent.id}, ${deniedEvent.type}, now(), ${transaction.json(deniedEvent as never)},
          ${randomUUID()}::uuid, 60
        )`;
      })).rejects.toThrow();
    }
  });

  it("stripe event ids are unique", async () => {
    await sql`insert into public.stripe_events (id, type, event_created, payload) values (${eventId}, 'fixture', now(), '{}')`;
    await expect(sql`insert into public.stripe_events (id, type, event_created, payload) values (${eventId}, 'fixture', now(), '{}')`).rejects.toThrow();
  });

  it("grants catalog snapshots and proves catalog, entitlement, signed object path, ledger, and SHA agree", async () => {
    const durations: number[] = [];
    for (const [index, play] of PLAYS.entries()) {
      const started = performance.now();
      const result = await fulfillCheckout({
        id: `cs_latency_${play.slug}`,
        customer_details: { email: latencyBuyerEmails[index], name: "Latency Fixture" },
        metadata: { play: play.slug },
      } as unknown as Stripe.Checkout.Session);
      durations.push(performance.now() - started);
      expect(result).toBe("created");
    }
    const replayedPlay = PLAYS[0];
    expect(await fulfillCheckout({
      id: `cs_latency_${replayedPlay.slug}`,
      amount_total: 49_900,
      customer_details: { email: latencyBuyerEmails[0], name: "Latency Fixture" },
      metadata: { play: replayedPlay.slug },
    } as unknown as Stripe.Checkout.Session)).toBe("existing");
    expect(await fulfillCheckout({
      id: `cs_latency_${replayedPlay.slug}_second_charge`,
      amount_total: 49_900,
      customer_details: { email: latencyBuyerEmails[0], name: "Latency Fixture" },
      metadata: { play: replayedPlay.slug },
    } as unknown as Stripe.Checkout.Session)).toBe("existing-duplicate-charge");

    const sortedDurations = durations.toSorted((a, b) => a - b);
    const p99 = sortedDurations[Math.ceil(sortedDurations.length * 0.99) - 1];
    writeFileSync(process.env.TEST_FULFILLMENT_LATENCY_PATH!, JSON.stringify({
      sample: durations.length,
      p99Ms: p99,
      maxMs: sortedDurations.at(-1)!,
    }));
    console.log(`FULFILLMENT_LATENCY sample=${durations.length} p99_ms=${p99.toFixed(1)} max_ms=${sortedDurations.at(-1)!.toFixed(1)}`);
    expect(p99).toBeLessThan(STRIPE_EVENT_LEASE_SECONDS * 1_000);

    const entitlements = await sql`
      select a.email, e.sku, e.bundle_version, e.bundle_sha256, e.license_key
      from public.entitlements e join public.accounts a on a.id = e.account_id
      where a.email in ${sql(latencyBuyerEmails)} order by e.sku
    `;
    expect(entitlements.map(({ sku }) => sku)).toEqual(PLAYS.map(({ slug }) => slug).sort());
    const catalogBySku = new Map(PLAYS.map((play) => [play.slug, play]));
    for (const entitlement of entitlements) {
      const play = catalogBySku.get(entitlement.sku);
      expect(play, `catalog entry for ${entitlement.sku}`).toBeDefined();
      expect(entitlement.bundle_version).toBe(play!.bundleVersion);
      expect(entitlement.bundle_sha256).toBe(play!.tarballSha256);
    }

    const downloadablePlay = PLAYS.find((play) => play.bundleVersion !== "2.0.0");
    expect(downloadablePlay, "catalog must retain a non-2.0.0 version sentinel").toBeDefined();
    const allowedEntitlement = entitlements.find(({ sku }) => sku === downloadablePlay!.slug)!;
    const otherEntitlement = entitlements.find(({ sku }) => sku !== downloadablePlay!.slug)!;
    const otherPlay = catalogBySku.get(otherEntitlement.sku)!;

    const denied = await download(new Request(`http://example.com/api/download?sku=${otherPlay.slug}&v=${otherPlay.bundleVersion}`, {
      headers: { authorization: `Bearer ${allowedEntitlement.license_key}`, accept: "application/json" },
    }));
    expect(denied.status).toBe(403);

    const staleVersion = "2.0.0";
    expect(downloadablePlay!.bundleVersion).not.toBe(staleVersion);
    const stale = await download(new Request(`http://example.com/api/download?sku=${downloadablePlay!.slug}&v=${staleVersion}`, {
      headers: { authorization: `Bearer ${allowedEntitlement.license_key}`, accept: "application/json" },
    }));
    expect(stale.status).toBe(403);

    const objectPath = `${downloadablePlay!.slug}/${downloadablePlay!.bundleVersion}.tgz`;
    const allowed = await download(new Request(`http://example.com/api/download?sku=${downloadablePlay!.slug}&v=${downloadablePlay!.bundleVersion}`, {
      headers: { authorization: `Bearer ${allowedEntitlement.license_key}`, accept: "application/json" },
    }));
    expect(allowed.status).toBe(200);
    const allowedPayload = await allowed.json();
    expect(allowedPayload.sha256).toBe(downloadablePlay!.tarballSha256);
    expect(allowedPayload.sha256).toBe(allowedEntitlement.bundle_sha256);
    const signedBundlePath = decodeURIComponent(new URL(allowedPayload.url).pathname).split("/paid-bundles/")[1];
    expect(signedBundlePath).toBe(objectPath);
    const [bundleDownload] = await sql`
      select sku, version from public.download_events
      where license_id = ${allowedPayload.licenseId} order by id desc limit 1
    `;
    expect(bundleDownload).toEqual({ sku: downloadablePlay!.slug, version: downloadablePlay!.bundleVersion });

    const cli = await download(new Request(`http://example.com/api/download?kind=cli&v=${runtimeRelease.version}`, {
      headers: { authorization: `Bearer ${allowedEntitlement.license_key}`, accept: "application/json" },
    }));
    expect(cli.status).toBe(200);
    const cliPayload = await cli.json();
    expect(cliPayload.sha256).toBe(runtimeRelease.sha256);
    const signedCliPath = decodeURIComponent(new URL(cliPayload.url).pathname).split("/paid-bundles/")[1];
    expect(signedCliPath).toBe(runtimeRelease.objectPath);
    const [cliDownload] = await sql`
      select sku, version from public.download_events
      where license_id = ${cliPayload.licenseId} order by id desc limit 1
    `;
    expect(cliDownload).toEqual({ sku: "_runtime", version: runtimeRelease.version });

    await sql`update public.entitlements set status = 'revoked' where sku = ${allowedEntitlement.sku} and account_id = (select id from public.accounts where email = ${allowedEntitlement.email})`;
    expect(await activeLicense(allowedEntitlement.license_key)).toBeNull();
  }, 60_000);

  it("[refund sentinel] full refund revokes entitlement and license in the real schema", async () => {
    const stripeSessionId = `cs_test_refund_${randomUUID()}`;
    expect(await fulfillCheckout({
      id: stripeSessionId,
      amount_total: 24_900,
      customer_details: { email: refundBuyerEmail, name: "Refund Fixture" },
      metadata: { play: "lead-bank-engine" },
    } as unknown as Stripe.Checkout.Session)).toBe("created");

    const [before] = await sql`
      select e.id, e.license_key, e.status as entitlement_status, l.status as license_status
      from public.entitlements e join public.licenses l on l.entitlement_id = e.id
      join public.accounts a on a.id = e.account_id
      where a.email = ${refundBuyerEmail} and e.sku = 'lead-bank-engine'
    `;
    expect(before.entitlement_status).toBe("active");
    expect(before.license_status).toBe("active");
    expect(await activeLicense(before.license_key)).not.toBeNull();

    const stripe = {
      checkout: { sessions: { list: async () => ({ data: [{ id: stripeSessionId }] }) } },
    } as unknown as Stripe;
    const charge = {
      amount: 24_900,
      amount_refunded: 24_900,
      payment_intent: `pi_test_${randomUUID()}`,
    } as unknown as Stripe.Charge;

    expect(await revokeForRefund(stripe, charge)).toBe("revoked");
    const [after] = await sql`
      select e.status as entitlement_status, l.status as license_status
      from public.entitlements e join public.licenses l on l.entitlement_id = e.id
      where e.id = ${before.id}
    `;
    expect(after.entitlement_status).toBe("revoked");
    expect(after.license_status).toBe("revoked");
    expect(await activeLicense(before.license_key)).toBeNull();
  }, 30_000);

  it("fulfills one signed Stripe event and treats its replay as an idempotent terminal duplicate", async () => {
    const event = checkoutEvent({ id: webhookEventId, email: webhookBuyerEmail });
    const first = await webhook(signedRequest(event));
    expect(first.status).toBe(200);
    expect((await first.json()).outcome).toBe("created");
    const replay = await webhook(signedRequest(event));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ duplicate: true, outcome: "created" });
    const [counts] = await sql`
      select
        (select count(*)::int from public.entitlements e join public.accounts a on a.id = e.account_id where a.email = ${webhookBuyerEmail}) as entitlements,
        (select count(*)::int from public.licenses l join public.entitlements e on e.id = l.entitlement_id join public.accounts a on a.id = e.account_id where a.email = ${webhookBuyerEmail}) as licenses
    `;
    expect(counts).toEqual({ entitlements: 1, licenses: 1 });
  });

  it("rolls back the entitlement when the license insert fails inside the atomic grant", async () => {
    const session = checkoutEvent({
      id: `evt_atomic_${randomUUID()}`,
      email: atomicBuyerEmail,
      sessionId: `cs_test_atomicity_${randomUUID()}`,
    }).data.object as Stripe.Checkout.Session;

    await sql.unsafe(`
      create or replace function public.ops351_reject_atomicity_fixture()
      returns trigger
      language plpgsql
      set search_path = public, pg_temp
      as $$
      begin
        if exists (
          select 1 from public.entitlements
          where id = new.entitlement_id
            and stripe_session_id like 'cs_test_atomicity_%'
        ) then
          raise exception 'injected license insert failure';
        end if;
        return new;
      end;
      $$
    `);
    await sql.unsafe(`
      create trigger ops351_reject_atomicity_fixture
      before insert on public.licenses
      for each row execute function public.ops351_reject_atomicity_fixture()
    `);

    try {
      await expect(fulfillCheckout(session)).rejects.toThrow();
      const [counts] = await sql`
        select
          (select count(*)::int from public.entitlements e join public.accounts a on a.id = e.account_id where a.email = ${atomicBuyerEmail}) as entitlements,
          (select count(*)::int from public.licenses l join public.entitlements e on e.id = l.entitlement_id join public.accounts a on a.id = e.account_id where a.email = ${atomicBuyerEmail}) as licenses
      `;
      expect(counts).toEqual({ entitlements: 0, licenses: 0 });
    } finally {
      await sql.unsafe("drop trigger if exists ops351_reject_atomicity_fixture on public.licenses");
      await sql.unsafe("drop function if exists public.ops351_reject_atomicity_fixture()");
    }
  });

  it("fences an expired worker while its replacement claim is still processing", async () => {
    const event = verifiedEvent(checkoutEvent({ id: fencingEventId }));
    const expiredToken = randomUUID();
    const replacementToken = randomUUID();
    await sql`
      insert into public.stripe_events (
        id, type, event_created, payload, outcome, processing_token, processing_started_at, attempt_count
      ) values (
        ${event.id}, ${event.type}, ${new Date(event.created * 1_000)}, ${sql.json(event as never)},
        'processing', ${expiredToken}::uuid, now() - interval '16 minutes', 1
      )
    `;

    const admin = createAdminClient();
    const { data: replacementClaim, error: claimError } = await admin.rpc("claim_stripe_event", {
      p_id: event.id,
      p_type: event.type,
      p_event_created: new Date(event.created * 1_000).toISOString(),
      p_payload: event,
      p_token: replacementToken,
      p_lease_seconds: STRIPE_EVENT_LEASE_SECONDS,
    });
    expect(claimError).toBeNull();
    expect(replacementClaim).toMatchObject({ status: "claimed", attempt_count: 2 });

    const [processing] = await sql`
      select outcome, processing_token::text, processed_at, attempt_count
      from public.stripe_events where id = ${fencingEventId}
    `;
    expect(processing).toEqual({
      outcome: "processing",
      processing_token: replacementToken,
      processed_at: null,
      attempt_count: 2,
    });

    const { data: expiredFinalize, error: expiredFinalizeError } = await admin.rpc("finalize_stripe_event", {
      p_id: fencingEventId,
      p_token: expiredToken,
      p_outcome: "failed",
    });
    expect(expiredFinalizeError).toBeNull();
    expect(expiredFinalize).toBe(false);

    const [stillProcessing] = await sql`
      select outcome, processing_token::text, processed_at, attempt_count
      from public.stripe_events where id = ${fencingEventId}
    `;
    expect(stillProcessing).toEqual(processing);

    const { data: replacementFinalize, error: replacementFinalizeError } = await admin.rpc("finalize_stripe_event", {
      p_id: fencingEventId,
      p_token: replacementToken,
      p_outcome: "ignored",
    });
    expect(replacementFinalizeError).toBeNull();
    expect(replacementFinalize).toBe(true);
    const [terminal] = await sql`
      select outcome, processing_token::text, processed_at is not null as finalized, attempt_count
      from public.stripe_events where id = ${fencingEventId}
    `;
    expect(terminal).toEqual({
      outcome: "ignored",
      processing_token: replacementToken,
      finalized: true,
      attempt_count: 2,
    });
  });

  it("reconciles an expired processing lease without a Stripe retry", async () => {
    const event = verifiedEvent(checkoutEvent({ id: crashEventId, email: crashBuyerEmail }));
    const expiredToken = randomUUID();
    await sql`
      insert into public.stripe_events (
        id, type, event_created, payload, outcome, processing_token, processing_started_at, attempt_count
      ) values (
        ${event.id}, ${event.type}, ${new Date(event.created * 1_000)}, ${sql.json(event as never)},
        'processing', ${expiredToken}::uuid, now() - interval '16 minutes', 1
      )
    `;

    const unauthorized = await reconcile(new Request("http://example.com/api/internal/reconcile-stripe-events"));
    expect(unauthorized.status).toBe(401);
    const firstResponse = await reconcile(new Request("http://example.com/api/internal/reconcile-stripe-events", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }));
    expect(firstResponse.status).toBe(200);
    const firstRun = await firstResponse.json();
    expect(firstRun).toMatchObject({ scanned: 1, completed: 1, failed: 0, capped: false });
    const [ledger] = await sql`select outcome, attempt_count from public.stripe_events where id = ${crashEventId}`;
    expect(ledger).toEqual({ outcome: "created", attempt_count: 2 });
    const [counts] = await sql`
      select
        (select count(*)::int from public.entitlements e join public.accounts a on a.id = e.account_id where a.email = ${crashBuyerEmail}) as entitlements,
        (select count(*)::int from public.licenses l join public.entitlements e on e.id = l.entitlement_id join public.accounts a on a.id = e.account_id where a.email = ${crashBuyerEmail}) as licenses
    `;
    expect(counts).toEqual({ entitlements: 1, licenses: 1 });

    const secondResponse = await reconcile(new Request("http://example.com/api/internal/reconcile-stripe-events", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }));
    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.json()).toMatchObject({ scanned: 0, completed: 0, failed: 0 });
    const [countsAfter] = await sql`
      select
        (select count(*)::int from public.entitlements e join public.accounts a on a.id = e.account_id where a.email = ${crashBuyerEmail}) as entitlements,
        (select count(*)::int from public.licenses l join public.entitlements e on e.id = l.entitlement_id join public.accounts a on a.id = e.account_id where a.email = ${crashBuyerEmail}) as licenses
    `;
    expect(countsAfter).toEqual(counts);
  });

  it("reclaims only after the configured processing lease expires", async () => {
    const event = verifiedEvent(checkoutEvent({ id: freshEventId, email: freshBuyerEmail }));
    const currentToken = randomUUID();
    const replacementToken = randomUUID();
    await sql`
      insert into public.stripe_events (
        id, type, event_created, payload, outcome, processing_token, processing_started_at, attempt_count
      ) values (
        ${event.id}, ${event.type}, ${new Date(event.created * 1_000)}, ${sql.json(event as never)},
        'processing', ${currentToken}::uuid, now() - interval '30 seconds', 1
      )
    `;

    const admin = createAdminClient();
    const claimArgs = {
      p_id: event.id,
      p_type: event.type,
      p_event_created: new Date(event.created * 1_000).toISOString(),
      p_payload: event,
      p_token: replacementToken,
      p_lease_seconds: STRIPE_EVENT_LEASE_SECONDS,
    };
    const { data: freshClaim, error: freshClaimError } = await admin.rpc("claim_stripe_event", claimArgs);
    expect(freshClaimError).toBeNull();
    expect(freshClaim).toMatchObject({ status: "busy", attempt_count: 1 });
    const [freshLedger] = await sql`
      select outcome, processing_token::text, attempt_count
      from public.stripe_events where id = ${freshEventId}
    `;
    expect(freshLedger).toEqual({ outcome: "processing", processing_token: currentToken, attempt_count: 1 });

    await sql`
      update public.stripe_events
      set processing_started_at = clock_timestamp() - make_interval(secs => ${STRIPE_EVENT_LEASE_SECONDS + 1})
      where id = ${freshEventId}
    `;
    const { data: expiredClaim, error: expiredClaimError } = await admin.rpc("claim_stripe_event", claimArgs);
    expect(expiredClaimError).toBeNull();
    expect(expiredClaim).toMatchObject({ status: "claimed", attempt_count: 2 });
    const [expiredLedger] = await sql`
      select outcome, processing_token::text, attempt_count
      from public.stripe_events where id = ${freshEventId}
    `;
    expect(expiredLedger).toEqual({ outcome: "processing", processing_token: replacementToken, attempt_count: 2 });
    const [account] = await sql`select count(*)::int as count from public.accounts where email = ${freshBuyerEmail}`;
    expect(account.count).toBe(0);
  });

  it("repairs a failed entitlement-without-license retry from its stored snapshot and key", async () => {
    const play = PLAYS.find(({ slug }) => slug === "lead-bank-engine")!;
    const event = verifiedEvent(checkoutEvent({ id: orphanEventId, email: orphanBuyerEmail }));
    const session = event.data.object as Stripe.Checkout.Session;
    const admin = createAdminClient();
    const { data: createdUser, error: userError } = await admin.auth.admin.createUser({ email: orphanBuyerEmail, email_confirm: true });
    expect(userError).toBeNull();
    const accountId = randomUUID();
    const storedLicenseKey = `pk_test_${randomUUID().replaceAll("-", "")}`;
    const storedVersion = "1.7.3-orphan-fixture";
    const storedSha = "a".repeat(64);
    expect(storedVersion).not.toBe(play.bundleVersion);
    expect(storedSha).not.toBe(play.tarballSha256);
    await sql`insert into public.accounts (id, user_id, email) values (${accountId}, ${createdUser.user!.id}, ${orphanBuyerEmail})`;
    const [entitlement] = await sql`
      insert into public.entitlements (
        account_id, sku, license_key, bundle_version, bundle_sha256, version_ceiling,
        "grant", org_name, stripe_session_id
      ) values (
        ${accountId}, ${play.slug}, ${storedLicenseKey}, ${storedVersion}, ${storedSha},
        now() + interval '1 year', 'single-org-source-visible', 'Orphan Fixture', ${session.id}
      ) returning id, bundle_version, bundle_sha256, license_key
    `;
    await sql`
      insert into public.stripe_events (
        id, type, event_created, payload, outcome, processed_at, processing_token, processing_started_at, attempt_count
      ) values (
        ${event.id}, ${event.type}, ${new Date(event.created * 1_000)}, ${sql.json(event as never)},
        'failed', now(), ${randomUUID()}::uuid, now(), 1
      )
    `;

    const response = await webhook(signedRequest(event));
    expect(response.status).toBe(200);
    expect((await response.json()).outcome).toBe("repaired-existing");
    const pairs = await sql`
      select e.id, e.bundle_version, e.bundle_sha256, e.license_key, l.key_hash
      from public.entitlements e left join public.licenses l on l.entitlement_id = e.id
      where e.account_id = ${accountId} and e.sku = ${play.slug}
    `;
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual({
      id: entitlement.id,
      bundle_version: storedVersion,
      bundle_sha256: storedSha,
      license_key: storedLicenseKey,
      key_hash: hashLicense(storedLicenseKey),
    });

    const replay = await webhook(signedRequest(event));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ duplicate: true, outcome: "repaired-existing" });
    const [counts] = await sql`
      select
        (select count(*)::int from public.entitlements where account_id = ${accountId}) as entitlements,
        (select count(*)::int from public.licenses where entitlement_id = ${entitlement.id}) as licenses
    `;
    expect(counts).toEqual({ entitlements: 1, licenses: 1 });
  });

  it("ignores absent Play metadata but keeps unknown slugs and missing buyers as genuine failures", async () => {
    const foreign = checkoutEvent({ id: foreignEventId, email: foreignBuyerEmail, play: null });
    const ignored = await webhook(signedRequest(foreign));
    expect(ignored.status).toBe(200);
    expect((await ignored.json()).outcome).toBe("ignored-non-plays-checkout");
    const ignoredReplay = await webhook(signedRequest(foreign));
    expect(ignoredReplay.status).toBe(200);
    expect(await ignoredReplay.json()).toMatchObject({ duplicate: true, outcome: "ignored-non-plays-checkout" });

    const unknown = checkoutEvent({ id: unknownEventId, email: unknownBuyerEmail, play: "not-a-real-play" });
    const failed = await webhook(signedRequest(unknown));
    expect(failed.status).toBe(500);
    const missingBuyer = checkoutEvent({ id: missingBuyerEventId, play: "lead-bank-engine" });
    const missingBuyerFailure = await webhook(signedRequest(missingBuyer));
    expect(missingBuyerFailure.status).toBe(500);
    const rows = await sql`
      select id, outcome from public.stripe_events
      where id in (${foreignEventId}, ${unknownEventId}, ${missingBuyerEventId}) order by id
    `;
    expect(rows).toContainEqual({ id: foreignEventId, outcome: "ignored-non-plays-checkout" });
    expect(rows).toContainEqual({ id: unknownEventId, outcome: "failed" });
    expect(rows).toContainEqual({ id: missingBuyerEventId, outcome: "failed" });
    const accounts = await sql`select email from public.accounts where email in (${foreignBuyerEmail}, ${unknownBuyerEmail})`;
    expect(accounts).toHaveLength(0);
  });

  it("reports when reconciliation hits its 50-row cap and leaves the overflow visible", async () => {
    for (const id of cappedEventIds) {
      const event = verifiedEvent(checkoutEvent({ id, email: `foreign-${id}@example.invalid`, play: null }));
      await sql`
        insert into public.stripe_events (
          id, type, event_created, payload, outcome, processing_token, processing_started_at, attempt_count
        ) values (
          ${event.id}, ${event.type}, ${new Date(event.created * 1_000)}, ${sql.json(event as never)},
          'processing', ${randomUUID()}::uuid, now() - interval '2 minutes', 1
        )
      `;
    }
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await reconcileStaleStripeEvents(60)).toMatchObject({
        scanned: 50,
        completed: 50,
        failed: 0,
        capped: true,
      });
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("batch cap hit"));
    } finally {
      warning.mockRestore();
    }
    const [remaining] = await sql`
      select count(*)::int as count from public.stripe_events
      where id = any(${cappedEventIds}) and outcome = 'processing'
    `;
    expect(remaining.count).toBe(1);
  });
});
