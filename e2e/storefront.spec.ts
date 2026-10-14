import { test, expect } from "@playwright/test";

// What a stranger sees. These run against a real deployment.
//
// CORRECTION 2026-08-20 (cleanup): the original note here said these tests "never complete
// a payment", which was true and misleading. Reaching the Stripe page REQUIRES the server to create
// a Checkout Session at the provider, and against production that key is live-mode. Each full run
// created four live-mode $499 sessions; 34 accumulated in the account's history, every one of them
// ours, which pollutes live session data as if it were buyer demand. Not completing a payment is
// not the same as creating nothing at the provider.
//
// The session-creating tests are therefore opt-in. Restoring them by default needs a Stripe
// TEST-MODE restricted key, which does not exist in the vault today and is a payment-provider
// change this seat cannot make.

const PLAY = "lead-bank-engine";
const LIVE_CHECKOUT = process.env.E2E_ALLOW_LIVE_CHECKOUT === "1";

test("marketplace lists plays and each carries a price", async ({ page }) => {
  await page.goto("/plays");
  await expect(page).toHaveTitle(/\bPlays\b/);
  const prices = page.locator("text=/\\$\\d/");
  expect(await prices.count()).toBeGreaterThan(0);
});

test("play page renders the price a buyer will be charged", async ({ page }) => {
  await page.goto(`/plays/${PLAY}`);
  await expect(page.locator("body")).toContainText(/\$\d/);
  await expect(page.getByRole("button", { name: /buy|get|purchase/i }).first()).toBeVisible();
});

// Default-path replacement for the gated tests below. Proves the buy wiring reaches OUR checkout
// route carrying the slug of the play whose price is displayed, and that the request is intercepted
// before the server can create anything at the payment provider. It does NOT prove the price Stripe
// shows the buyer -- only a session-creating run can, which is why the gated block still exists.
test("buy posts the shown play to our checkout route, creating no provider session", async ({ page }) => {
  await page.goto(`/plays/${PLAY}`);
  await expect(page.locator("body")).toContainText(/\$\d/);

  const posted: Array<{ url: string; slug: unknown }> = [];
  await page.route("**/api/checkout", async (route) => {
    const request = route.request();
    let slug: unknown = null;
    try {
      slug = JSON.parse(request.postData() ?? "{}").slug ?? null;
    } catch {
      slug = null;
    }
    posted.push({ url: request.url(), slug });
    // Never let this reach the server: the route creates a real Checkout Session at Stripe.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ configured: false }),
    });
  });

  await page.getByTestId("buy-button").click();
  await expect(page.getByTestId("buy-msg")).toBeVisible();

  expect(posted.length, "buy must POST to our own checkout route").toBe(1);
  expect(posted[0].url).toContain("/api/checkout");
  expect(posted[0].slug).toBe(PLAY);
  // and the buyer must still be on the play page, never handed off to a provider
  expect(page.url()).toContain(`/plays/${PLAY}`);
});

test.describe("live provider handoff", () => {
  test.skip(
    !LIVE_CHECKOUT,
    "skipped: each of these creates a real Stripe Checkout Session, and against production that is LIVE mode. " +
      "Set E2E_ALLOW_LIVE_CHECKOUT=1 to run them. UNPROVEN while skipped: the price Stripe actually shows the " +
      "buyer, back-button recovery, and double-click session reuse. Restoring by default needs a Stripe test-mode key.",
  );

  test("buy reaches checkout.stripe.com with the same price rendered", async ({ page }) => {
    await page.goto(`/plays/${PLAY}`);

    const shown = await page.locator("body").innerText();
    const priceMatch = shown.match(/\$([\d,]+)/);
    expect(priceMatch, "play page must show a price").not.toBeNull();
    const price = priceMatch![1].replace(/,/g, "");

    await page.getByRole("button", { name: /buy|get|purchase/i }).first().click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 });
    expect(page.url()).toContain("checkout.stripe.com");

    // the price the storefront advertised must be the price Stripe charges
    await expect(page.locator("body")).toContainText(new RegExp(`\\$${price}`), { timeout: 30_000 });
  });

  test("back button after checkout returns to a working play page", async ({ page }) => {
    await page.goto(`/plays/${PLAY}`);
    await page.getByRole("button", { name: /buy|get|purchase/i }).first().click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 });

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/plays/${PLAY}`));
    // the page must still be usable, not a stale or errored shell
    await expect(page.getByRole("button", { name: /buy|get|purchase/i }).first()).toBeVisible();
  });

  test("clicking buy twice does not strand the buyer", async ({ page }) => {
    await page.goto(`/plays/${PLAY}`);
    const buy = page.getByRole("button", { name: /buy|get|purchase/i }).first();

    await buy.click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 });
    const first = page.url();

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/plays/${PLAY}`));
    await page.getByRole("button", { name: /buy|get|purchase/i }).first().click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 });

    // A second attempt must produce a usable checkout, not a dead or reused-expired session.
    expect(page.url()).toContain("checkout.stripe.com");
    expect(page.url()).not.toBe(first);
    await expect(page.locator("body")).toContainText(/\$\d/, { timeout: 30_000 });
  });
});

test("unknown play returns not found rather than an error page", async ({ page }) => {
  const res = await page.goto("/plays/this-play-does-not-exist");
  expect(res?.status()).toBe(404);
});
