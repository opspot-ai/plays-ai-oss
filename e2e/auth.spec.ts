import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import Stripe from "stripe";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL!;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const databaseUrl = process.env.TEST_DATABASE_URL!;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;
const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";
const mailpitUrl = process.env.TEST_MAILPIT_URL!;

let admin: SupabaseClient;
let sql: Sql;

test.beforeAll(() => {
  if (!googleEnabled) throw new Error("auth gate requires the hermetic Google OAuth fixture; the flag may not be disabled.");
  if (!mailpitUrl) throw new Error("auth gate requires the dedicated Mailpit endpoint.");
  admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  sql = postgres(databaseUrl, { max: 1 });
});

test.afterAll(async () => {
  await sql.end();
});

async function clean(email: string, eventId: string) {
  await sql`delete from public.stripe_events where id = ${eventId}`;
  await sql`delete from auth.users where email = ${email}`;
}

async function userIdFor(email: string): Promise<string> {
  const [user] = await sql`select id from auth.users where email = ${email}`;
  expect(user?.id).toBeTruthy();
  return user.id;
}

async function attachGoogleIdentity(userId: string, email: string) {
  const providerId = `google-${randomUUID()}`;
  await sql`
    insert into auth.identities (
      id, provider_id, user_id, identity_data, provider, last_sign_in_at,
      created_at, updated_at
    ) values (
      ${randomUUID()}, ${providerId}, ${userId},
      ${sql.json({ sub: providerId, email, email_verified: true })},
      'google', now(), now(), now()
    )
  `;
  await sql`
    update auth.users
    set raw_app_meta_data = jsonb_build_object('provider', 'google', 'providers', array['email', 'google'])
    where id = ${userId}
  `;
  const [identity] = await sql`
    select user_id from auth.identities where provider = 'google' and email = ${email}
  `;
  return identity.user_id as string;
}

async function fulfill(request: APIRequestContext, email: string, eventId: string) {
  const payload = JSON.stringify({
    id: eventId,
    object: "event",
    api_version: "2025-02-24.acacia",
    created: Math.floor(Date.now() / 1_000),
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_test_${randomUUID()}`,
        object: "checkout.session",
        amount_total: 49900,
        customer_details: { email, name: "Auth Test Buyer" },
        metadata: { play: "lead-bank-engine" },
      },
    },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
  const response = await request.post("/api/stripe/webhook", {
    data: payload,
    headers: { "content-type": "application/json", "stripe-signature": signature },
  });
  expect(response.status()).toBe(200);
  expect((await response.json()).outcome).toBe("created");
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/library");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Lead-Bank Engine" })).toBeVisible();
}

async function recoveryLink(request: APIRequestContext, email: string): Promise<string> {
  let messageId = "";
  await expect.poll(async () => {
    const response = await request.get(`${mailpitUrl}/api/v1/messages`);
    const body = await response.json();
    messageId = body.messages.find((message: { Subject: string; To: Array<{ Address: string }> }) =>
      message.Subject.toLowerCase().includes("reset") &&
      message.To.some((recipient) => recipient.Address === email))?.ID ?? "";
    return messageId;
  }).not.toBe("");
  const response = await request.get(`${mailpitUrl}/api/v1/message/${messageId}`);
  const message = await response.json();
  const link = (message.Text as string).match(/https?:\/\/[^\s)]+/)?.[0];
  expect(link).toBeTruthy();
  return link!;
}

test("signed-out library offers all three auth methods and password recovery", async ({ page }) => {
  await page.goto("/library");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Set or reset password" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Email me a magic link" })).toBeVisible();
  console.log(`GOOGLE_FLAG enabled=${googleEnabled} button=${googleEnabled ? "visible" : "hidden"}`);
});

test("Google starts a PKCE authorize request for the library callback", async ({ page }) => {
  await page.goto("/library");
  const requestPromise = page.waitForRequest((request) => request.url().includes("/auth/v1/authorize"));
  await page.getByRole("button", { name: "Continue with Google" }).click();
  const authorize = new URL((await requestPromise).url());
  expect(authorize.searchParams.get("provider")).toBe("google");
  expect(authorize.searchParams.get("redirect_to")).toBe(`${siteUrl}/auth/callback?next=/library`);
  expect(authorize.searchParams.get("code_challenge_method")).toBe("s256");
  expect(authorize.searchParams.get("code_challenge")).toBeTruthy();
  expect(authorize.searchParams.get("prompt")).toBe("select_account");
  console.log(`GOOGLE_AUTHORIZE provider=google redirect_to=${authorize.searchParams.get("redirect_to")} code_challenge_method=s256 prompt=select_account`);
});

test("OAuth errors return to the signed-out library", async ({ page }) => {
  await page.goto("/auth/callback?error=access_denied&error_description=The+user+canceled");
  await expect(page).toHaveURL(/\/library\?authError=oauth$/);
  await expect(page.getByRole("status")).toContainText("sign-in was canceled or failed");
});

test("email and password create an empty account that can sign in again", async ({ page, context }) => {
  const email = `password-signup-${randomUUID()}@example.com`;
  const eventId = `evt_auth_${randomUUID()}`;
  const password = `Plays-${randomUUID()}a1`;
  try {
    await page.goto("/library");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "No plays on the roster yet" })).toBeVisible();
    const userId = await userIdFor(email);

    await context.clearCookies();
    await page.goto("/library");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "No plays on the roster yet" })).toBeVisible();
    const [counts] = await sql`
      select
        (select count(*)::int from public.accounts where user_id = ${userId}) as accounts,
        (select count(*)::int from public.entitlements e join public.accounts a on a.id = e.account_id where a.user_id = ${userId}) as entitlements
    `;
    expect(counts).toEqual({ accounts: 0, entitlements: 0 });
    console.log(`PASSWORD_SIGNUP user_id=${userId} password_sign_in=succeeded account_rows=0 entitlement_rows=0 library=empty`);
  } finally {
    await context.clearCookies();
    await clean(email, eventId);
  }
});

test("buyer first keeps the same entitlement after a Google identity fixture is linked and password reset runs", async ({ page, request, context }) => {
  const email = `buyer-first-${randomUUID()}@example.com`;
  const eventId = `evt_auth_${randomUUID()}`;
  const password = `Plays-${randomUUID()}a1`;
  try {
    await fulfill(request, email, eventId);
    const beforeUserId = await userIdFor(email);
    const linkedUserId = await attachGoogleIdentity(beforeUserId, email);
    expect(linkedUserId).toBe(beforeUserId);

    await page.goto("/library");
    await page.getByLabel("Email").fill(email);
    await page.waitForTimeout(1_100);
    await page.getByRole("button", { name: "Set or reset password" }).click();
    await expect(page.getByRole("status")).toContainText("check your inbox");
    await page.goto(await recoveryLink(request, email));
    await page.getByLabel("New password").fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Save password" }).click();
    await expect(page).toHaveURL(/\/library$/);

    await context.clearCookies();
    await signIn(page, email, password);
    const entitlements = await sql`
      select e.sku from public.entitlements e
      join public.accounts a on a.id = e.account_id
      where a.user_id = ${beforeUserId} order by e.sku
    `;
    expect(entitlements.map(({ sku }) => sku)).toEqual(["lead-bank-engine"]);
    console.log(`BUYER_FIRST identity_source=local_fixture before_user_id=${beforeUserId} linked_google_user_id=${linkedUserId} password_reset=completed password_sign_in=succeeded entitlements=lead-bank-engine library=rendered`);
  } finally {
    await clean(email, eventId);
  }
});

test("Google identity fixture first stays empty until purchase then fulfillment uses the same user", async ({ page, request, context }) => {
  const email = `google-first-${randomUUID()}@example.com`;
  const eventId = `evt_auth_${randomUUID()}`;
  const password = `Plays-${randomUUID()}a1`;
  try {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    expect(error).toBeNull();
    const googleUserId = data.user!.id;
    await attachGoogleIdentity(googleUserId, email);
    const { error: passwordError } = await admin.auth.admin.updateUserById(googleUserId, { password });
    expect(passwordError).toBeNull();

    await page.goto("/library");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "No plays on the roster yet" })).toBeVisible();

    await fulfill(request, email, eventId);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Lead-Bank Engine" })).toBeVisible();
    const [account] = await sql`
      select a.user_id, count(*) over ()::int as account_count
      from public.accounts a where a.email = ${email}
    `;
    const entitlements = await sql`
      select e.sku from public.entitlements e
      join public.accounts a on a.id = e.account_id
      where a.email = ${email} order by e.sku
    `;
    expect(account.user_id).toBe(googleUserId);
    expect(account.account_count).toBe(1);
    expect(entitlements.map(({ sku }) => sku)).toEqual(["lead-bank-engine"]);
    console.log(`GOOGLE_FIRST identity_source=local_fixture google_user_id=${googleUserId} account_user_id=${account.user_id} account_rows=1 before_purchase=empty after_purchase=lead-bank-engine library=rendered`);
  } finally {
    await context.clearCookies();
    await clean(email, eventId);
  }
});
