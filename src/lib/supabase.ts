import { createBrowserClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

function isBrowserRuntime(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  // middleware.ts reads the session from cookies only (createServerClient with
  // getAll/setAll). A plain createClient() with no `storage` option persists to
  // localStorage instead, so the token login writes is invisible to the
  // middleware and every authenticated request is redirected back to /login.
  // createBrowserClient persists to document.cookie under the same
  // `sb-<project-ref>-auth-token` storage key the server client reads, which is
  // what makes the two halves agree.
  if (isBrowserRuntime()) {
    client = createBrowserClient(supabaseUrl, supabaseAnonKey);
    return client;
  }

  // Outside the browser (server render / pre-render) there is no document.cookie
  // to write to. @supabase/ssr's browser storage throws in that case, so fall
  // back to the cookie-less client. Every call site only touches `supabase`
  // inside an effect or an event handler, never during render, so this branch
  // is never actually asked to hold a session.
  client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}

// Preserve the existing call-site API while delaying configuration validation until use.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    return Reflect.get(getSupabaseClient() as object, property);
  },
});
