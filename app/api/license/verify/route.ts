import { NextResponse } from "next/server";
import { activeLicense } from "@/lib/fulfillment";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const license = typeof body.license === "string" ? body.license : "";
  const active = await activeLicense(license);
  if (!active) return NextResponse.json({ error: "License inactive." }, { status: 403 });
  return NextResponse.json({
    active: true,
    sku: active.entitlement.sku,
    version: active.entitlement.bundle_version,
  });
}
