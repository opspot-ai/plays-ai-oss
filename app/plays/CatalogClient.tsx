"use client";
import { useMemo, useState } from "react";
import PlayCard from "@/components/PlayCard";
import { PLAYS, CATEGORIES } from "@/lib/plays";

export default function CatalogClient({ initialCat }: { initialCat: string }) {
  const validInitial = CATEGORIES.includes(initialCat as never) ? initialCat : "All";
  const [cat, setCat] = useState<string>(validInitial);
  const [q, setQ] = useState("");

  const filtered = useMemo(
    () =>
      PLAYS.filter(
        (p) =>
          (cat === "All" || p.category === cat) &&
          (q.trim() === "" ||
            (p.name + p.tagline + p.summary).toLowerCase().includes(q.toLowerCase())),
      ),
    [cat, q],
  );

  return (
    <section className="section">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">The full playbook</span>
          <h2>Every play in the book</h2>
          <p className="lead">
            Every package includes the Play and the complete Team needed to run it.
          </p>
        </div>

        <input
          type="search"
          placeholder="Search the playbook…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="search"
          aria-label="Search plays"
          style={{
            width: "100%",
            maxWidth: 440,
            padding: "13px 16px",
            borderRadius: 12,
            border: "1px solid var(--border-strong)",
            fontFamily: "inherit",
            fontSize: "1rem",
            background: "var(--surface-card)",
          }}
        />

        <div className="pills" style={{ margin: "18px 0 30px" }}>
          <button className="pill" aria-pressed={cat === "All"} onClick={() => setCat("All")}>
            All
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              className="pill"
              aria-pressed={cat === c}
              onClick={() => setCat(c)}
              data-testid={`pill-${c}`}
            >
              {c}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <p className="muted" data-testid="empty">
            No plays match that. Try another category or clear the search.
          </p>
        ) : (
          <div className="grid grid-3" data-testid="play-grid">
            {filtered.map((p) => (
              <PlayCard key={p.slug} play={p} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
