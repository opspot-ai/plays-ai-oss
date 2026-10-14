import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { assertFulfillmentEnv } from "@/lib/env";

export async function createUserClient() {
  assertFulfillmentEnv();
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (values) => {
          try {
            values.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Server Components cannot set cookies; callback and route handlers can.
          }
        },
      },
    },
  );
}
