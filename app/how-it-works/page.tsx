import Link from "next/link";

export const metadata = {
  title: "How it works — Plays",
  description: "Install a plain-text workflow into your repo and run it with the coding agents you already use.",
};

export default function HowItWorks() {
  return (
    <>
      <section className="hero" style={{ paddingBottom: 48 }}>
        <div className="container">
          <span className="hero-badge"><span className="pulse" aria-hidden /> Your repo, your agents</span>
          <h1>Install the play. Use the subscriptions you already pay for.</h1>
          <p className="lead">
            A Play is a versioned workflow and its Team is the complete lineup of Players that executes it.
            Harnesses and models are replaceable machinery.
          </p>
        </div>
      </section>

      <section className="section dark">
        <div className="container">
          <span className="eyebrow on-dark">The game plan</span>
          <h2>Buy once. Install. Run.</h2>
          <div className="steps">
            {[
              ["Choose a Play", "Buy the workflow and the complete Team required to run it."],
              ["Meet your Team", "Your private library reveals the Players, assignments, and handoffs."],
              ["Install it", "The private CLI writes the Play, Team, overrides, and project-safe adapters."],
              ["Pick the machinery", "Use Claude Code, Codex, Hermes, OpenClaw, Cursor, and your own models."],
              ["Keep the receipt", "Mode B records Player, provider, savings, validation, and outcome."],
            ].map(([title, body], index) => (
              <div className="step" key={title}>
                <div className="num">{index + 1}</div>
                <h4>{title}</h4>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">The honest version</span>
            <h2>What you&rsquo;re buying / what you&rsquo;re not</h2>
          </div>
          <div className="grid grid-2">
            <article className="card">
              <h3>You are buying</h3>
              <ul className="checklist">
                <li>Plain text you can inspect, edit, and keep forever</li>
                <li>Offline execution with no phone-home license check</li>
                <li>The complete Team plus adapters for Claude Code, Codex, Hermes, OpenClaw, and Cursor</li>
                <li>12 months of bundle updates</li>
              </ul>
            </article>
            <article className="card">
              <h3>You are not buying</h3>
              <ul className="checklist">
                <li>A hosted agent or managed execution service</li>
                <li>Model credits or another subscription</li>
                <li>A black box that holds your credentials</li>
                <li>A workflow that can be remotely disabled after install</li>
              </ul>
            </article>
          </div>
          <div style={{ marginTop: 36 }}>
            <Link className="btn btn-primary btn-lg" href="/plays">Open the playbook</Link>
          </div>
        </div>
      </section>
    </>
  );
}
