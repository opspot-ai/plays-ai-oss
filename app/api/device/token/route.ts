import { NextResponse } from "next/server";
import { hashDeviceCode, verifyDeviceCode } from "@/lib/device-code";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const code = typeof body.device_code === "string" ? body.device_code : "";
  if (!verifyDeviceCode(code)) return NextResponse.json({ error: "Device code invalid or expired." }, { status: 400 });
  const admin = createAdminClient();
  const { data: account } = await admin
    .from("accounts")
    .select("id,pending_device_code_expires_at")
    .eq("pending_device_code_hash", hashDeviceCode(code))
    .maybeSingle();
  if (!account || new Date(account.pending_device_code_expires_at).getTime() < Date.now()) {
    return NextResponse.json({ pending: true }, { status: 202 });
  }
  const { data: entitlement } = await admin
    .from("entitlements")
    .select("license_key")
    .eq("account_id", account.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!entitlement) return NextResponse.json({ error: "No active entitlement." }, { status: 403 });
  await admin.from("accounts").update({
    pending_device_code_hash: null,
    pending_device_code_expires_at: null,
  }).eq("id", account.id);
  return NextResponse.json({ license: entitlement.license_key });
}
