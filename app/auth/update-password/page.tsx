"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export default function UpdatePassword() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirmation) {
      setMessage("Passwords do not match.");
      return;
    }
    setBusy(true);
    setMessage("");
    const { error } = await createBrowserSupabaseClient().auth.updateUser({ password });
    if (error) {
      setMessage(error.message);
      setBusy(false);
      return;
    }
    window.location.assign("/library");
  }

  return (
    <section className="section">
      <div className="container">
        <div className="card" style={{ maxWidth: 620 }}>
          <h1>Set your password</h1>
          <form onSubmit={save} style={{ display: "grid", gap: 12, width: "100%" }}>
            <label htmlFor="new-password" style={{ fontWeight: 700 }}>New password</label>
            <input id="new-password" type="password" autoComplete="new-password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} />
            <label htmlFor="confirm-password" style={{ fontWeight: 700 }}>Confirm password</label>
            <input id="confirm-password" type="password" autoComplete="new-password" required minLength={6} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
            <button className="btn btn-primary" disabled={busy}>{busy ? "Saving..." : "Save password"}</button>
            {message && <p role="status" className="muted">{message}</p>}
          </form>
        </div>
      </div>
    </section>
  );
}
