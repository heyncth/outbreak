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

export function browserClient(): SupabaseClient {
  return createClient(url, publishable, { auth: { persistSession: false } });
}

export function serverClient(): SupabaseClient {
  if (!secret) throw new Error("Missing SUPABASE_SECRET_KEY");
  return createClient(url, secret, { auth: { persistSession: false } });
}
