import Link from "next/link";
import { fulfillmentEnabled } from "@/lib/env";
import { getPlay } from "@/lib/plays";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Purchase complete — Plays" };
export const dynamic = "force-dynamic";

export default async function Success({
  searchParams,
}: {
  searchParams: Promise<{ play?: string; session_id?: string }>;
}) {
  const sp = await searchParams;
  const play = sp.play ? getPlay(sp.play) : undefined;
  let licenseKey = "";
  if (fulfillmentEnabled() && sp.session_id) {
    const { data } = await createAdminClient()
      .from("entitlements")
      .select("license_key")
      .eq("stripe_session_id", sp.session_id)
      .maybeSingle();
    licenseKey = data?.license_key ?? "";
  }

  return (
    <section className="section">
      <div className="container">
        <div className="card" style={{ maxWidth: 660, margin: "0 auto", padding: 40 }}>
          <span className="badge badge-green">✓ Purchase complete</span>
          <h1 style={{ fontSize: "2rem", marginTop: 16 }}>
            {play ? `${play.name} is on your roster.` : "You're all set."}
          </h1>
          <p className="lead" style={{ flex: "none" }}>
            Your magic link is on the way. The bundle installs into your current project.
          </p>
          <ol style={{ paddingLeft: 20, margin: "20px 0", lineHeight: 1.9 }}>
            <li><strong>Open your library</strong> from the magic link sent to the checkout email.</li>
            <li><strong>Store the license</strong> with <code>npx @plays-ai/cli login</code>.</li>
            <li><strong>Install</strong> with <code>npx @plays-ai/cli install {play?.slug ?? "&lt;play&gt;"}</code>.</li>
            <li><strong>Check it</strong> with <code>plays doctor {play?.slug ?? "&lt;play&gt;"}</code>.</li>
          </ol>
          {licenseKey && (
            <div className="notice notice-ok">
              License key: <code style={{ overflowWrap: "anywhere" }}>{licenseKey}</code>
            </div>
          )}
          <div className="notice notice-info">
            The installed play is plain text, runs offline, and never phones home for permission.
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 22, flexWrap: "wrap" }}>
            <Link className="btn btn-primary" href="/library">Go to my roster</Link>
            <Link className="btn btn-ghost" href="/plays">Back to the playbook</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
