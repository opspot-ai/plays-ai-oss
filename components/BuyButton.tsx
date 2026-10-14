"use client";
import { useState } from "react";

export default function BuyButton({ slug, label = "Buy this Play" }: { slug: string; label?: string }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgKind, setMsgKind] = useState<"warn" | "info">("warn");
  const [owned, setOwned] = useState(false);

  async function buy() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      if (data.alreadyOwned) {
        setOwned(true);
        setMsgKind("info");
        setMsg("You already own this play. It's in your roster, no need to buy it twice.");
      } else if (data.configured === false) {
        setMsgKind("info");
        setMsg("Test checkout is not connected on this preview. No payment was taken.");
      } else {
        setMsgKind("warn");
        setMsg(data.error || "Something went wrong. Please try again.");
      }
    } catch {
      setMsgKind("warn");
      setMsg("Network error — please try again.");
    }
    setLoading(false);
  }

  return (
    <div>
      <button
        className="btn btn-primary btn-lg btn-block"
        onClick={buy}
        disabled={loading}
        data-testid="buy-button"
      >
        {loading ? "Starting checkout…" : label}
      </button>
      {msg && (
        <div className={`notice notice-${msgKind}`} role="status" data-testid="buy-msg">
          {msg}
        </div>
      )}
      {owned && (
        <a className="btn btn-secondary btn-block" href="/library" data-testid="open-roster">
          Open my roster
        </a>
      )}
    </div>
  );
}
