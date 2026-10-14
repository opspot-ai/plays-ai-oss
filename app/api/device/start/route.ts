import { NextResponse } from "next/server";
import { createDeviceCode } from "@/lib/device-code";
import { assertFulfillmentEnv } from "@/lib/env";

export async function POST() {
  assertFulfillmentEnv();
  const code = createDeviceCode();
  return NextResponse.json({
    device_code: code.token,
    user_code: code.userCode,
    verification_uri: `${process.env.NEXT_PUBLIC_SITE_URL}/device?code=${encodeURIComponent(code.token)}`,
    expires_in: 600,
    interval: 2,
  });
}
