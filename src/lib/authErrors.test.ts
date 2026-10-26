import { describe, expect, it } from "vitest";
import { getAuthErrorMessage } from "./authErrors";

describe("getAuthErrorMessage", () => {
  it("returns a friendly message for Supabase configuration errors", () => {
    const error = new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
    expect(getAuthErrorMessage(error)).toBe(
      "Authentication service is not available. Please contact your administrator."
    );
  });

  it("passes through the message for other Error instances", () => {
    const error = new Error("Invalid login credentials");
    expect(getAuthErrorMessage(error)).toBe("Invalid login credentials");
  });

  it("returns a fallback for non-Error throws", () => {
    expect(getAuthErrorMessage("something went wrong")).toBe(
      "An unexpected error occurred. Please try again."
    );
    expect(getAuthErrorMessage(undefined)).toBe(
      "An unexpected error occurred. Please try again."
    );
    expect(getAuthErrorMessage(null)).toBe(
      "An unexpected error occurred. Please try again."
    );
    expect(getAuthErrorMessage({ code: 500 })).toBe(
      "An unexpected error occurred. Please try again."
    );
  });
});
