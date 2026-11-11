import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishable =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";
const secret = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishable) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or publishable key");
}

let cachedServer: SupabaseClient | null = null;

export function serverClient(): SupabaseClient {
  if (!secret) throw new Error("Missing SUPABASE_SECRET_KEY");
  if (!cachedServer) {
    cachedServer = createClient(url, secret, {
      auth: { persistSession: false },
      // Next patches server fetch into its data cache — stale reads (WAITING after ACTIVE)
      global: {
        fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
      },
    });
  }
  return cachedServer;
}
