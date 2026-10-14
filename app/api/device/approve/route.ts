import { NextResponse } from "next/server";
import { hashDeviceCode, verifyDeviceCode } from "@/lib/device-code";
import { createAdminClient } from "@/lib/supabase/admin";
import { createUserClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code : "";
  if (!verifyDeviceCode(code)) return NextResponse.json({ error: "Device code invalid or expired." }, { status: 400 });
  const userClient = await createUserClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in before approving this device." }, { status: 401 });
  const { error } = await createAdminClient()
    .from("accounts")
    .update({
      pending_device_code_hash: hashDeviceCode(code),
      pending_device_code_expires_at: new Date(Date.now() + 10 * 60 * 1_000).toISOString(),
    })
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Could not approve device." }, { status: 500 });
  return NextResponse.json({ approved: true });
}
