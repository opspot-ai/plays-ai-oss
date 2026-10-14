import Link from "next/link";
import DeviceApproveButton from "@/components/DeviceApproveButton";
import { verifyDeviceCode } from "@/lib/device-code";
import { createUserClient } from "@/lib/supabase/server";

export default async function DevicePage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code = "" } = await searchParams;
  const supabase = await createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <section className="section">
      <div className="container">
        <div className="card" style={{ maxWidth: 620 }}>
          <h1>Approve CLI login</h1>
          {!verifyDeviceCode(code) ? (
            <p>This device code is invalid or expired.</p>
          ) : !user ? (
            <p>Open your magic link first, then return here. <Link href="/library">Go to your library.</Link></p>
          ) : (
            <DeviceApproveButton code={code} />
          )}
        </div>
      </div>
    </section>
  );
}
