"use client";

import { useRef, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type Props = {
  googleEnabled: boolean;
  siteUrl: string;
  initialMessage?: string;
};

export default function AuthForm({ googleEnabled, siteUrl, initialMessage = "" }: Props) {
  const form = useRef<HTMLFormElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState(initialMessage);
  const [busy, setBusy] = useState("");

  async function google() {
    setBusy("google");
    setMessage("");
    const { error } = await createBrowserSupabaseClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${siteUrl}/auth/callback?next=/library`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setMessage("Google sign-in could not start. Try another option.");
      setBusy("");
    }
  }

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy("password");
    setMessage("");
    const { error } = await createBrowserSupabaseClient().auth.signInWithPassword({ email, password });
    if (error) {
      setMessage("Email or password is incorrect. You can set or reset your password below.");
      setBusy("");
      return;
    }
    window.location.assign("/library");
  }

  async function signUp() {
    if (!form.current?.reportValidity()) return;
    setBusy("signup");
    setMessage("");
    const { data, error } = await createBrowserSupabaseClient().auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${siteUrl}/auth/callback?next=/library` },
    });
    if (error) {
      setMessage(error.message);
    } else if (data.session) {
      window.location.assign("/library");
      return;
    } else {
      setMessage("Check your inbox to finish creating your account. Already bought? Use password reset instead.");
    }
    setBusy("");
  }

  async function resetPassword() {
    if (!emailInput.current?.reportValidity()) return;
    setBusy("reset");
    setMessage("");
    const { error } = await createBrowserSupabaseClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/auth/callback?next=/auth/update-password`,
    });
    setMessage(error ? error.message : "If that email has an account, check your inbox to set a password.");
    setBusy("");
  }

  async function magicLink() {
    if (!emailInput.current?.reportValidity()) return;
    setBusy("magic");
    setMessage("");
    const response = await fetch("/api/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const body = await response.json();
    setMessage(response.ok ? "Magic link sent. Check your inbox." : body.error || "Could not send link.");
    setBusy("");
  }

  return (
    <form ref={form} onSubmit={signIn} style={{ display: "grid", gap: 12, width: "100%" }}>
      {googleEnabled && (
        <button type="button" className="btn btn-ghost" disabled={Boolean(busy)} onClick={google}>
          {busy === "google" ? "Opening Google..." : "Continue with Google"}
        </button>
      )}
      <label htmlFor="library-email" style={{ fontWeight: 700 }}>Email</label>
      <input ref={emailInput} id="library-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
      <label htmlFor="library-password" style={{ fontWeight: 700 }}>Password</label>
      <input id="library-password" type="password" autoComplete="current-password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} />
      <button className="btn btn-primary" disabled={Boolean(busy)}>{busy === "password" ? "Signing in..." : "Sign in"}</button>
      <button type="button" className="btn btn-ghost" disabled={Boolean(busy)} onClick={signUp}>{busy === "signup" ? "Creating account..." : "Create account"}</button>
      <button type="button" className="btn btn-ghost" disabled={Boolean(busy)} onClick={resetPassword}>{busy === "reset" ? "Sending reset..." : "Set or reset password"}</button>
      <button type="button" className="btn btn-ghost" disabled={Boolean(busy)} onClick={magicLink}>{busy === "magic" ? "Sending magic link..." : "Email me a magic link"}</button>
      {message && <p role="status" className="muted">{message}</p>}
    </form>
  );
}
