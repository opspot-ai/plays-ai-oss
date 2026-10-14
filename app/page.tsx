import Link from "next/link";
import PlayCard from "@/components/PlayCard";
import PlayDiagram from "@/components/PlayDiagram";
import { PLAYS, CATEGORIES } from "@/lib/plays";

export default function Home() {
  const flagships = PLAYS.filter((p) => p.flagship);
  return (
    <>
      <section className="hero">
        <div className="container">
          <div className="hero-inner">
            <div>
              <span className="hero-badge">
                <span className="pulse" aria-hidden /> 🏈 The playbook for your AI team
              </span>
              <h1>Buy a play. Drop it in. It runs.</h1>
              <p className="lead">
                Every Play includes the complete Team of Players needed to run it. Install the package
                into your repo and use whichever harnesses and models you already trust.
              </p>
              <div className="hero-cta">
                <Link className="btn btn-primary btn-lg" href="/plays">Open the playbook</Link>
                <Link className="btn btn-ghost btn-lg" href="/how-it-works">The game plan</Link>
              </div>
              <p className="hero-note">
                Plain text. Your repo. Your credentials. No phone-home permission check.
              </p>
            </div>
            <PlayDiagram />
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">The starting lineup</span>
            <h2>Your MVP plays</h2>
            <p className="lead">
              Complete workflow-and-Team packages for the jobs that move the chains.
            </p>
          </div>
          <div className="grid grid-3">
            {flagships.map((p) => (
              <PlayCard key={p.slug} play={p} />
            ))}
          </div>
        </div>
      </section>

      <section className="section dark">
        <div className="container">
          <span className="eyebrow on-dark">The game plan</span>
          <h2>From &ldquo;I need this&rdquo; to game day — in five steps</h2>
          <div className="steps">
            {[
              ["Call the play", "Pick a packaged workflow. Pay once and keep the plain-text files."],
              ["Meet the Team", "Your purchase includes every Player configuration and handoff the Play needs."],
              ["Drop it in", "Install the Play and Team into your own repository with the private CLI."],
              ["Pick the machinery", "Run it with Claude Code, Codex, Hermes, OpenClaw, or Cursor."],
              ["Keep the proof", "Route work across your subscriptions and keep a Player-aware receipt."],
            ].map(([h, b], i) => (
              <div className="step" key={i}>
                <div className="num">{i + 1}</div>
                <h4>{h}</h4>
                <p>{b}</p>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 40 }}>
            <Link className="btn btn-accent btn-lg" href="/plays">Draft your first play</Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">What you&rsquo;re buying</span>
            <h2>A workflow, not another hosted platform</h2>
            <p className="lead">
              You get plain text you can inspect, change, and keep forever, plus 12 months of updates.
              It runs from your repo, can execute offline, and never phones home for permission.
            </p>
          </div>
          <div className="tool-tags" aria-label="Supported coding-agent harnesses">
            {["Claude Code", "Codex", "Hermes", "OpenClaw", "Cursor"].map((name) => (
              <span className="tool-tag" key={name}>{name}</span>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 20 }}>
            You are not buying managed execution, bundled model usage, or access to your credentials.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">The full playbook</span>
            <h2>Every play in the book</h2>
          </div>
          <div className="pills">
            {CATEGORIES.map((c) => (
              <Link key={c} href={`/plays?cat=${encodeURIComponent(c)}`} className="pill">
                {c}
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
