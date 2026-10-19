/**
 * Maps an unknown thrown value from a Supabase auth call to a user-facing
 * error message.
 *
 * Supabase auth failures surface as `AuthError` objects whose `.message` is
 * human-readable.  The Proxy in `src/lib/supabase.ts` throws a plain `Error`
 * when `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are missing —
 * previously this throw escaped `handleLogin` unhandled, leaving the button
 * stuck in `isLoading = true` with no message.  Any other non-Error throw
 * (strings, objects, undefined) gets a generic fallback.
 */
export function getAuthErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message;
    if (message.includes("not configured")) {
      return "Authentication service is not available. Please contact your administrator.";
    }
    return message;
  }
  return "An unexpected error occurred. Please try again.";
}
