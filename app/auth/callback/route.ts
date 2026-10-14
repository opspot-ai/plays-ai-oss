import { NextResponse } from "next/server";
import { createUserClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("next");
  const next = requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/library";
  if (url.searchParams.has("error")) {
    return NextResponse.redirect(new URL("/library?authError=oauth", url.origin));
  }
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/library?authError=callback", url.origin));

  const { error } = await (await createUserClient()).auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL(error ? "/library?authError=callback" : next, url.origin));
}
