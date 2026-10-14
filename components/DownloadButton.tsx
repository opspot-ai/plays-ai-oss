"use client";

import { useState } from "react";

export default function DownloadButton({
  sku,
  version,
  license,
  kind = "bundle",
  label = "Download Play + Team",
}: {
  sku: string;
  version: string;
  license: string;
  kind?: "bundle" | "cli";
  label?: string;
}) {
  const [error, setError] = useState("");
  async function download() {
    setError("");
    const response = await fetch(`/api/download?kind=${kind}&sku=${encodeURIComponent(sku)}&v=${encodeURIComponent(version)}`, {
      headers: { authorization: `Bearer ${license}`, accept: "application/json" },
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "Download failed.");
      return;
    }
    window.location.assign(body.url);
  }
  return (
    <>
      <button className="btn btn-ghost" onClick={download}>{label}</button>
      {error && <span role="alert" className="muted">{error}</span>}
    </>
  );
}
