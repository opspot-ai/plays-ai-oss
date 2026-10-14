import Link from "next/link";
import type { Metadata } from "next";
import AuthForm from "@/components/AuthForm";
import DownloadButton from "@/components/DownloadButton";
import { fulfillmentEnabled } from "@/lib/env";
import { getPlay } from "@/lib/plays";
import runtimeRelease from "@/lib/runtime-release.generated.json";
import { createAdminClient } from "@/lib/supabase/admin";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "My roster — Plays",
  description: "Your purchased plays, install commands, license keys, and updates.",
};
export const dynamic = "force-dynamic";

type TeamSummary = {
  name: string;
  quarterback: string;
  lineup: Array<{ name: string; position: string; assignment: string }>;
};

async function loadTeamSummary(sku: string, version: string): Promise<TeamSummary | null> {
  const { data, error } = await createAdminClient().storage
    .from(process.env.BUNDLE_STORAGE_BUCKET!)
    .download(`_teams/${sku}/${version}.json`);
  if (error || !data) return null;
  return JSON.parse(await data.text()) as TeamSummary;
}

export default async function Library({ searchParams }: { searchParams: Promise<{ authError?: string }> }) {
  if (!fulfillmentEnabled()) {
    return (
      <section className="section">
        <div className="container">
          <div className="card" style={{ maxWidth: 620 }}>
            <h1>Your roster</h1>
            <p>This preview has no account backend connected. Purchases are not enabled here.</p>
            <Link className="btn btn-primary" href="/plays">Open the playbook</Link>
          </div>
        </div>
      </section>
    );
  }

  const supabase = await createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const { authError } = await searchParams;
    return (
      <section className="section">
        <div className="container">
          <div className="card" style={{ maxWidth: 620 }}>
            <h1>Your roster</h1>
            <p>Sign in with your checkout email, Google account, or a password. An account alone does not add Plays to your roster.</p>
            <AuthForm
              googleEnabled={process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true"}
              siteUrl={process.env.NEXT_PUBLIC_SITE_URL!}
              initialMessage={authError ? "The sign-in was canceled or failed. Try again or use another option." : undefined}
            />
          </div>
        </div>
      </section>
    );
  }

  const { data: account } = await supabase.from("accounts").select("id").eq("user_id", user.id).maybeSingle();
  const { data: entitlements } = account
    ? await supabase
      .from("entitlements")
      .select("sku,license_key,bundle_version,version_ceiling,grant,org_name")
      .eq("account_id", account.id)
      .eq("status", "active")
      .order("created_at")
    : { data: [] };
  const roster = await Promise.all((entitlements ?? []).map(async (entitlement) => ({
    entitlement,
    play: getPlay(entitlement.sku),
    team: await loadTeamSummary(entitlement.sku, entitlement.bundle_version),
  })));

  return (
    <section className="section">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">My roster</span>
          <h1>Your purchased plays</h1>
        </div>
        {!roster.length ? (
          <div className="card" style={{ maxWidth: 620 }}>
            <h3>No plays on the roster yet</h3>
            <p>Your purchases will show up here after the webhook grants them.</p>
            <Link className="btn btn-primary" href="/plays">Open the playbook</Link>
          </div>
        ) : (
          <>
            <article className="card" style={{ marginBottom: 24 }}>
              <span className="badge badge-green">Private CLI</span>
              <h2 style={{ marginTop: 12 }}>Set up the Plays runtime once</h2>
              <ol>
                <li>Download the private CLI tarball.</li>
                <li><code>npm install -g ./plays-ai-runtime-{runtimeRelease.version}.tgz</code></li>
                <li><code>plays login</code></li>
                <li><code>plays install &lt;slug&gt;</code></li>
              </ol>
              <p className="muted">SHA-256: <code>{runtimeRelease.sha256}</code></p>
              <DownloadButton
                kind="cli"
                sku=""
                version={runtimeRelease.version}
                license={roster[0].entitlement.license_key}
                label="Download private CLI"
              />
            </article>
            <div className="grid grid-2">
            {roster.map(({ entitlement, play, team }) => (
              <article className="card" key={entitlement.sku}>
                <span className="badge badge-green">Available</span>
                <h2 style={{ marginTop: 12 }}>{play?.name ?? entitlement.sku}</h2>
                <p className="muted">{entitlement.org_name} · updates through {new Date(entitlement.version_ceiling).toLocaleDateString()}</p>
                <h3>Meet Your Team</h3>
                {team ? (
                  <>
                    <p><strong>{team.name}</strong></p>
                    <ul className="checklist">
                      {team.lineup.map((member) => (
                        <li key={`${entitlement.sku}-${member.name}`}>
                          <strong>{member.name}</strong> · {member.position}<br />
                          <span className="muted">{member.assignment}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : <p className="muted">Team summary is being prepared.</p>}
                <p><strong>Install</strong></p>
                <code>plays install {entitlement.sku}</code>
                <p style={{ marginTop: 18 }}><strong>License key</strong></p>
                <code style={{ overflowWrap: "anywhere" }}>{entitlement.license_key}</code>
                <div style={{ marginTop: 20 }}>
                  <DownloadButton sku={entitlement.sku} version={entitlement.bundle_version} license={entitlement.license_key} />
                </div>
              </article>
            ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
