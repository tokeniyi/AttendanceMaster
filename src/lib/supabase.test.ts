import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { getSupabaseClient } from "./supabase";

/**
 * Regression cover for backlog #2: middleware.ts and src/lib/supabase.ts used
 * two incompatible auth strategies. middleware.ts read cookies only, while
 * supabase.ts built a plain createClient() with no `storage` option, which
 * persists to localStorage. The token login wrote was therefore invisible to
 * the middleware and every authenticated request was redirected back to
 * /login.
 *
 * These tests execute the real client constructors against a stubbed Auth
 * server, so they pin the storage medium itself rather than re-describing it.
 *
 * No jsdom: the libraries only check `typeof window`/`typeof document` and read
 * `document.cookie`, so a hand-rolled stand-in is enough and keeps the suite on
 * the existing node environment (no new dependency).
 */

const localStorageStore: Record<string, string> = {};
let cookieJar = "";

function readStoredSession(): Record<string, unknown> | null {
  const raw = Object.entries(localStorageStore)
    .find(([key]) => key.endsWith("-auth-token"))?.[1];
  return raw ? JSON.parse(raw) : null;
}

/** Every cookie currently in the jar, in `name=value; name=value` form. */
function cookieHeader(): string {
  return cookieJar
    .split("; ")
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

const session = {
  access_token: "access-token-1",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: "refresh-token-1",
  user: { id: "user-1", aud: "authenticated", role: "authenticated", email: "a@b.c" },
};

/** Minimal stand-in for the Supabase Auth server. */
function stubAuthServer() {
  return vi.fn(async (url: unknown) => {
    const target = String(url);
    if (target.includes("/token")) {
      return new Response(JSON.stringify(session), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(session.user), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

const URL_BASE = "https://probe-project.supabase.co";
const ANON_KEY = "anon-key";

beforeEach(() => {
  cookieJar = "";
  for (const key of Object.keys(localStorageStore)) delete localStorageStore[key];

  (globalThis as any).window = { document: {} };
  (globalThis as any).document = {
    get cookie() {
      return cookieJar;
    },
    set cookie(value: string) {
      cookieJar = cookieJar ? `${cookieJar}; ${value}` : value;
    },
  };
  (globalThis as any).localStorage = {
    getItem: (k: string) => localStorageStore[k] ?? null,
    setItem: (k: string, v: string) => {
      localStorageStore[k] = v;
    },
    removeItem: (k: string) => {
      delete localStorageStore[k];
    },
  };
});

afterEach(() => {
  // window/document/localStorage are deliberately NOT torn down here. The auth
  // client schedules an auto-refresh tick that can fire after the test body
  // returns; removing the globals mid-flight makes it log "document is not
  // defined". Each beforeEach resets the cookie jar and storage, so state
  // still cannot leak between tests.
  delete (globalThis as any).fetch;
  vi.restoreAllMocks();
});

/** The strategy src/lib/supabase.ts used BEFORE the fix. */
function legacyClient(authFetch: ReturnType<typeof stubAuthServer>) {
  return createClient(URL_BASE, ANON_KEY, { global: { fetch: authFetch as any } });
}

/** The strategy src/lib/supabase.ts uses AFTER the fix (browser branch). */
function fixedClient(authFetch: ReturnType<typeof stubAuthServer>) {
  return createBrowserClient(URL_BASE, ANON_KEY, {
    global: { fetch: authFetch as any },
    isSingleton: false,
  });
}

/**
 * The regression test proper: drive the repo's own module rather than a
 * client we build in the test. The two strategies above document the bug and
 * the fix; this one fails if src/lib/supabase.ts itself regresses back to the
 * localStorage variant.
 */
async function loadModuleInBrowserRuntime() {
  vi.resetModules();
  const mod = await import("./supabase");
  return mod.getSupabaseClient;
}

describe("getSupabaseClient (backlog #2)", () => {
  const OLD_ENV = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL_BASE;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
  });

  afterEach(() => {
    if (OLD_ENV.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = OLD_ENV.url;
    if (OLD_ENV.key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = OLD_ENV.key;
  });

  it("persists the signed-in session to document.cookie so middleware can read it", async () => {
    const authFetch = stubAuthServer();
    (globalThis as any).fetch = authFetch;

    const getClient = await loadModuleInBrowserRuntime();
    const client = getClient();
    const { error } = await client.auth.signInWithPassword({ email: "a@b.c", password: "pw" });
    expect(error).toBeNull();

    // The session must be in a cookie the middleware's server client can read.
    expect(cookieJar).toContain("sb-probe-project-auth-token=");
    expect(readStoredSession()).toBeNull();
  });

  it("memoises the client instead of constructing a new one per call", async () => {
    const authFetch = stubAuthServer();
    (globalThis as any).fetch = authFetch;

    const getClient = await loadModuleInBrowserRuntime();
    expect(getClient()).toBe(getClient());
  });
});

describe("session storage strategy (backlog #2)", () => {
  it("REGRESSION: the old plain createClient stored the session in localStorage, where middleware cannot see it", async () => {
    const authFetch = stubAuthServer();
    (globalThis as any).fetch = authFetch;
    const client = legacyClient(authFetch);

    const { error } = await client.auth.signInWithPassword({ email: "a@b.c", password: "pw" });
    expect(error).toBeNull();

    // The bug: sign-in succeeds, a real session exists - and it is in
    // localStorage, so document.cookie is empty.
    expect(readStoredSession()?.access_token).toBe("access-token-1");
    expect(cookieJar).toBe("");
  });

  it("the fixed browser client persists the session to document.cookie, not localStorage", async () => {
    const authFetch = stubAuthServer();
    (globalThis as any).fetch = authFetch;
    const client = fixedClient(authFetch);

    const { error } = await client.auth.signInWithPassword({ email: "a@b.c", password: "pw" });
    expect(error).toBeNull();

    expect(cookieJar).toContain("sb-probe-project-auth-token=");
    expect(readStoredSession()).toBeNull();
  });

  it("the token written by the fixed client is readable by the middleware's server client", async () => {
    const authFetch = stubAuthServer();
    (globalThis as any).fetch = authFetch;

    await fixedClient(authFetch).auth.signInWithPassword({ email: "a@b.c", password: "pw" });

    // Reproduce middleware.ts exactly: cookie-only createServerClient.
    const request = new NextRequest("https://app.test/sessions/abc", {
      headers: { cookie: cookieHeader() },
    });
    const server = createServerClient(URL_BASE, ANON_KEY, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: () => {},
      },
      global: { fetch: authFetch as any },
    });

    const { data, error } = await server.auth.getUser();
    expect(error).toBeNull();
    // Before the fix this was null, so middleware redirected to /login.
    expect(data.user?.id).toBe("user-1");
  });

  it("with no cookie present the middleware server client sees no user, so the redirect still fires", async () => {
    const authFetch = stubAuthServer();
    (globalThis as any).fetch = authFetch;

    const request = new NextRequest("https://app.test/sessions/abc");
    const server = createServerClient(URL_BASE, ANON_KEY, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: () => {},
      },
      global: { fetch: authFetch as any },
    });

    const { data } = await server.auth.getUser();
    expect(data.user).toBeNull();
  });
});
