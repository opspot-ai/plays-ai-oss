import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { canonicalPlaySlug, getPlay, PLAYS, formatPrice } from "@/lib/plays";
import BuyButton from "@/components/BuyButton";

export function generateStaticParams() {
  return PLAYS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const canonical = canonicalPlaySlug(slug);
  if (canonical !== slug) redirect(`/plays/${canonical}`);
  const play = getPlay(slug);
  if (!play) return { title: "Play not found — Plays" };
  return { title: `${play.name} — Plays`, description: play.summary };
}

export default async function PlayDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const play = getPlay(slug);
  if (!play) notFound();

  return (
    <section className="section">
      <div className="container">
        <Link href="/plays" className="backlink">
          ← All plays
        </Link>
        <div className="detail-head">
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              <span className="badge badge-cat">{play.category}</span>
              {play.flagship && <span className="badge badge-flag">★ MVP</span>}
            </div>
            <h1 style={{ fontSize: "clamp(2rem, 4.5vw, 2.6rem)" }}>{play.name}</h1>
            <p className="lead">{play.tagline}</p>
            <p style={{ marginTop: 20 }}>{play.summary}</p>

            <div className="outcome-box">
              <span className="eyebrow">The scoreboard</span>
              <p style={{ margin: "6px 0 0", fontWeight: 600, color: "var(--brand-ink)" }}>
                {play.outcome}
              </p>
            </div>

            <h3 style={{ marginTop: 32 }}>What&rsquo;s in the play</h3>
            <ul className="checklist">
              {play.whatYouGet.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>

            <h3 style={{ marginTop: 28 }}>Tools it connects to</h3>
            <div className="tool-tags">
              {play.toolsNeeded.map((t, i) => (
                <span className="tool-tag" key={i}>
                  {t}
                </span>
              ))}
            </div>

            <h3 style={{ marginTop: 28 }}>Team and proof</h3>
            <ul className="checklist">
              <li>{play.teamSize} Players are included. Names and assignments unlock after purchase.</li>
              <li>Offline synthetic fixture included</li>
              <li>Player-aware routing and run receipts</li>
              <li>Byte-for-byte reproducible package with a published SHA-256</li>
            </ul>

            <h3 style={{ marginTop: 28 }}>Safe sample output</h3>
            <div className="outcome-box">
              <code>{play.sampleOutput}</code>
            </div>
          </div>

          <aside>
            <div className="buybox">
              <span className="price">{formatPrice(play.price)}</span>
              <span className="muted" style={{ fontSize: "0.9rem" }}>
                One-time · yours to keep
              </span>
              <div style={{ marginTop: 20 }}>
                <BuyButton slug={play.slug} label="Buy this Play" />
              </div>
              <ul className="checklist" style={{ marginTop: 18 }}>
                {play.safety.map((claim) => <li key={claim}>{claim}</li>)}
                <li>12 months of updates included</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
