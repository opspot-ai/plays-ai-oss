"use client";

import { useState } from "react";

export default function DeviceApproveButton({ code }: { code: string }) {
  const [message, setMessage] = useState("");
  async function approve() {
    const response = await fetch("/api/device/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    setMessage(response.ok ? "Device approved. Return to your terminal." : "Approval failed.");
  }
  return (
    <>
      <button className="btn btn-primary" onClick={approve}>Approve this device</button>
      {message && <p role="status">{message}</p>}
    </>
  );
}
