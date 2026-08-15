import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  client = createClient(supabaseUrl, supabaseAnonKey);
  return client;
}

// Preserve the existing call-site API while delaying configuration validation until use.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    return Reflect.get(getSupabaseClient() as object, property);
  },
});
