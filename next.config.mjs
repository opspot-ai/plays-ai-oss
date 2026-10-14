/** @type {import('next').NextConfig} */
if (process.env.FULFILLMENT_ENABLED === "true") {
  const required = [
    "NEXT_PUBLIC_SITE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "DEVICE_CODE_SECRET",
    "BUNDLE_STORAGE_BUCKET",
  ];
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length) throw new Error(`Fulfillment is enabled but env is missing: ${missing.join(", ")}`);
}

const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
