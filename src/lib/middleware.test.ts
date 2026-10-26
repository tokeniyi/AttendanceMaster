import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { config, middleware } from "../../middleware";

/**
 * Cover for the middleware guards added alongside the storage fix (backlog #2):
 * a network/auth-server error must not be treated as "signed out", and the
 * matcher must skip the tesseract WASM assets.
 *
 * `middleware` is imported once; process.env is set per-test before each call.
 */

const URL_BASE = "https://probe-project.supabase.co";
const ANON_KEY = "anon-key";

const session = {
  access_token: "access-token-1",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: "refresh-token-1",
  user: { id: "user-1", aud: "authenticated", role: "authenticated", email: "a@b.c" },
};

function authCookie(): string {
  return `sb-probe-project-auth-token=${encodeURIComponent(JSON.stringify(session))}`;
}

function setEnv(configured: boolean) {
  if (configured) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL_BASE;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
  } else {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  }
}

/** Auth server that always answers successfully. */
function okFetch() {
  return vi.fn(async () =>
    new Response(JSON.stringify(session.user), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

/**
 * Auth server that is down.
 *
 * Note this does NOT throw out of getUser(): the auth library catches the
 * network error and returns it as an `AuthRetryableFetchError`. A stub that
 * threw would exercise the wrong branch and would not model the real outage.
 */
function failingFetch() {
  return vi.fn(async () => {
    throw new TypeError("fetch failed");
  });
}

beforeEach(() => {
  setEnv(true);
});

afterEach(() => {
  setEnv(true);
  delete (globalThis as any).fetch;
  vi.restoreAllMocks();
});

describe("middleware", () => {
  it("redirects a signed-out user away from a protected route", async () => {
    (globalThis as any).fetch = okFetch();
    const res = await middleware(new NextRequest("https://app.test/sessions/abc"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.test/login");
  });

  it("lets a signed-in user through a protected route", async () => {
    (globalThis as any).fetch = okFetch();
    const res = await middleware(
      new NextRequest("https://app.test/sessions/abc", { headers: { cookie: authCookie() } }),
    );
    expect(res.status).toBe(200);
  });

  it("fails open when the Auth server is unreachable instead of logging the user out", async () => {
    (globalThis as any).fetch = failingFetch();
    const res = await middleware(
      new NextRequest("https://app.test/sessions/abc", { headers: { cookie: authCookie() } }),
    );
    // Before the try/catch this threw out of the middleware and 500'd.
    expect(res.status).toBe(200);
  });

  it("passes the request through when Supabase env vars are missing", async () => {
    setEnv(false);
    const res = await middleware(new NextRequest("https://app.test/sessions/abc"));
    expect(res.status).toBe(200);
  });
});

describe("middleware matcher", () => {
  // Next.js compiles each matcher entry into a regular expression anchored at
  // the root, e.g. "/x" becomes /^\/x(\/|$)/. This repo's single entry is a
  // positive matcher wrapped in a negative lookahead, so a path is guarded
  // exactly when that compiled pattern matches it. We compile the real
  // `config.matcher` string here rather than hard-coding a second copy of the
  // pattern that could drift from it.
  const [pattern] = config.matcher;
  const guards = new RegExp(`^${pattern.replace(/^\//, "/")}$`);

  const isMatched = (pathname: string) => guards.test(pathname);

  it("still guards app routes", () => {
    expect(isMatched("/")).toBe(true);
    expect(isMatched("/login")).toBe(true);
    expect(isMatched("/members")).toBe(true);
    expect(isMatched("/sessions/abc")).toBe(true);
  });

  it("skips static assets and tesseract WASM", () => {
    expect(isMatched("/_next/static/chunk")).toBe(false);
    expect(isMatched("/_next/image")).toBe(false);
    expect(isMatched("/favicon.ico")).toBe(false);
    expect(isMatched("/tesseract/worker.min.js")).toBe(false);
    expect(isMatched("/tesseract/tesseract-core.wasm")).toBe(false);
    expect(isMatched("/logo.svg")).toBe(false);
  });
});
