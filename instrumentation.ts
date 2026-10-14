export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertFulfillmentEnv } = await import("./lib/env");
    assertFulfillmentEnv();
  }
}
