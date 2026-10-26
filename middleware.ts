import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { pathname } = request.nextUrl;

  // An unconfigured deployment must not 500 on every route. Let the request
  // through; the pages themselves surface the configuration error.
  if (!supabaseUrl || !supabaseAnonKey) return response;

  let user: { id: string } | null = null;
  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookies: { name: string; value: string; options: CookieOptions }[]) {
          cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });

    const { data, error } = await supabase.auth.getUser();

    // getUser() reports failure as a returned `error`, not a throw, so the
    // outcomes have to be classified explicitly:
    //   - no error      -> data.user is authoritative
    //   - no session in cookie, or an invalid/revoked token -> genuinely
    //     signed out, redirect
    //   - network / 5xx -> Auth is unreachable, so fail OPEN: treating a
    //     transient outage as "signed out" bounces every user to /login.
    if (!error) {
      user = data.user;
    } else if (isAuthRetryableFetchError(error)) {
      return response;
    } else {
      user = null;
    }
  } catch {
    // An exception here means the client could not be constructed or the
    // request could not be read at all - an internal fault, not a sign-out.
    return response;
  }

  if (!user && pathname !== "/login") {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return response;
}

export const config = {
  // `tesseract/` serves static WASM. Running the auth guard over those requests
  // adds a round-trip to the Auth server for every worker/core asset and can
  // fail a page that would otherwise load.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|tesseract/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)"],
};
