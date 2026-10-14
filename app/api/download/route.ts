import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { activeLicense } from "@/lib/fulfillment";
import { createAdminClient } from "@/lib/supabase/admin";
import runtimeRelease from "@/lib/runtime-release.generated.json";

function bearer(request: Request): string {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const license = await activeLicense(bearer(request));
  const kind = url.searchParams.get("kind") === "cli" ? "cli" : "bundle";
  const sku = url.searchParams.get("sku") ?? "";
  const version = url.searchParams.get("v") || (kind === "cli" ? runtimeRelease.version : license?.entitlement.bundle_version) || "";
  const entitled = kind === "cli"
    ? Boolean(license && version === runtimeRelease.version)
    : Boolean(license && license.entitlement.sku === sku && license.entitlement.bundle_version === version);
  if (!license || !entitled) {
    return NextResponse.json({ error: "License inactive or not entitled." }, { status: 403 });
  }

  const admin = createAdminClient();
  const since = new Date(Date.now() - 60 * 60 * 1_000).toISOString();
  const { count, error: countError } = await admin
    .from("download_events")
    .select("*", { count: "exact", head: true })
    .eq("license_id", license.id)
    .gte("created_at", since);
  if (countError) return NextResponse.json({ error: "Download ledger unavailable." }, { status: 500 });
  if ((count ?? 0) >= Number(process.env.DOWNLOADS_PER_HOUR || 20)) {
    return NextResponse.json({ error: "Download limit reached. Try again later." }, { status: 429 });
  }

  const objectPath = kind === "cli" ? runtimeRelease.objectPath : `${sku}/${version}.tgz`;
  const downloadName = kind === "cli" ? `plays-ai-runtime-${version}.tgz` : `${sku}-v${version}.tgz`;
  const { data, error } = await admin.storage
    .from(process.env.BUNDLE_STORAGE_BUCKET!)
    .createSignedUrl(objectPath, 600, { download: downloadName });
  if (error || !data?.signedUrl) return NextResponse.json({ error: "Bundle unavailable." }, { status: 404 });

  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const ipHash = forwarded
    ? createHash("sha256").update(`${process.env.DEVICE_CODE_SECRET}:${forwarded}`).digest("hex")
    : null;
  await admin.from("download_events").insert({
    entitlement_id: license.entitlement.id,
    license_id: license.id,
    sku: kind === "cli" ? "_runtime" : sku,
    version,
    ip_hash: ipHash,
  });

  const payload = {
    url: data.signedUrl,
    sha256: kind === "cli" ? runtimeRelease.sha256 : license.entitlement.bundle_sha256,
    licenseId: license.id,
    orderingSalt: license.ordering_salt,
    expiresIn: 600,
  };
  if (request.headers.get("accept")?.includes("application/json")) return NextResponse.json(payload);
  return NextResponse.redirect(data.signedUrl, {
    headers: {
      "x-plays-bundle-sha256": payload.sha256,
      "x-plays-license-id": payload.licenseId,
    },
  });
}
