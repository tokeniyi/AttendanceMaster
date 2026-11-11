/**
 * Deleting a session (backlog #14).
 *
 * The DB row cascades, but the scan photo in the `attendance-scans` bucket does not, so it
 * used to be retained forever, unreachable once the row was gone. The photo is removed
 * after the row so a failed row delete never leaves a session pointing at a missing image.
 */

import { SCANS_BUCKET } from "@/lib/config";

interface DbResult { error: { message: string } | null }

/** Minimal structural slice of the Supabase client used here (keeps this unit-testable). */
export interface SessionDeletionClient {
  from(table: "sessions"): {
    delete(): { eq(column: "id", value: string): PromiseLike<DbResult> };
  };
  storage: {
    from(bucket: string): {
      remove(paths: string[]): PromiseLike<DbResult>;
    };
  };
}

export interface SessionDeletionResult {
  /** The session row was deleted. */
  deleted: boolean;
  /** The scan object was removed (or there was none to remove). */
  scanRemoved: boolean;
  error?: string;
}

export async function deleteSessionAndScan(
  client: SessionDeletionClient,
  session: { id: string; image_url?: string | null },
): Promise<SessionDeletionResult> {
  const rowRes = await client.from("sessions").delete().eq("id", session.id);
  if (rowRes.error) {
    return { deleted: false, scanRemoved: false, error: rowRes.error.message };
  }
  if (!session.image_url) return { deleted: true, scanRemoved: true };

  try {
    const res = await client.storage.from(SCANS_BUCKET).remove([session.image_url]);
    if (res.error) return { deleted: true, scanRemoved: false, error: res.error.message };
  } catch (e) {
    return { deleted: true, scanRemoved: false, error: e instanceof Error ? e.message : String(e) };
  }
  return { deleted: true, scanRemoved: true };
}
