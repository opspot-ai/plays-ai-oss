import { NextResponse } from "next/server";
import { activeLicense } from "@/lib/fulfillment";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const license = await activeLicense(authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "");
  const body = await request.json().catch(() => ({}));
  if (
    !license ||
    body.sku !== license.entitlement.sku ||
    body.sha256 !== license.entitlement.bundle_sha256
  ) {
    return NextResponse.json({ error: "License inactive or install does not match entitlement." }, { status: 403 });
  }
  const { error } = await createAdminClient().from("install_events").insert({
    entitlement_id: license.entitlement.id,
    license_id: license.id,
    bundle_sha256: license.entitlement.bundle_sha256,
    cli_version: typeof body.cliVersion === "string" ? body.cliVersion.slice(0, 32) : null,
  });
  if (error) return NextResponse.json({ error: "Install ledger unavailable." }, { status: 500 });
  return NextResponse.json({ recorded: true });
}
