import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function secret(): string {
  const value = process.env.DEVICE_CODE_SECRET;
  if (!value) throw new Error("DEVICE_CODE_SECRET is missing");
  return value;
}

export function createDeviceCode(): { token: string; userCode: string; expiresAt: number } {
  const nonce = randomBytes(24).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1_000) + 600;
  const payload = `${nonce}.${expiresAt}`;
  const signature = createHmac("sha256", secret()).update(payload).digest("base64url");
  return { token: `${payload}.${signature}`, userCode: nonce.slice(0, 8).toUpperCase(), expiresAt };
}

export function verifyDeviceCode(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3 || Number(parts[1]) < Date.now() / 1_000) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = createHmac("sha256", secret()).update(payload).digest();
  let actual: Buffer;
  try { actual = Buffer.from(parts[2], "base64url"); } catch { return false; }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function hashDeviceCode(token: string): string {
  return createHmac("sha256", secret()).update(token).digest("hex");
}
