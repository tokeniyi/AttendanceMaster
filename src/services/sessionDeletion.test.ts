import { describe, expect, it, vi } from "vitest";
import { deleteSessionAndScan, type SessionDeletionClient } from "./sessionDeletion";

function makeClient(opts: { rowError?: string; storageError?: string; storageThrows?: boolean } = {}) {
  const calls: string[] = [];
  const remove = vi.fn(async (paths: string[]) => {
    calls.push(`remove:${paths.join(",")}`);
    if (opts.storageThrows) throw new Error("network");
    return { error: opts.storageError ? { message: opts.storageError } : null };
  });
  const client: SessionDeletionClient = {
    from: () => ({
      delete: () => ({
        eq: async (_c, id) => {
          calls.push(`delete:${id}`);
          return { error: opts.rowError ? { message: opts.rowError } : null };
        },
      }),
    }),
    storage: { from: () => ({ remove }) },
  };
  return { client, calls, remove };
}

describe("deleteSessionAndScan", () => {
  it("deletes the row, then the scan object", async () => {
    const { client, calls } = makeClient();
    const r = await deleteSessionAndScan(client, { id: "s1", image_url: "u/a.jpg" });
    expect(r).toEqual({ deleted: true, scanRemoved: true });
    expect(calls).toEqual(["delete:s1", "remove:u/a.jpg"]);
  });

  it("keeps the scan when the row delete fails", async () => {
    const { client, remove } = makeClient({ rowError: "denied" });
    const r = await deleteSessionAndScan(client, { id: "s1", image_url: "u/a.jpg" });
    expect(r).toEqual({ deleted: false, scanRemoved: false, error: "denied" });
    expect(remove).not.toHaveBeenCalled();
  });

  it("skips storage when the session has no image", async () => {
    const { client, remove } = makeClient();
    const r = await deleteSessionAndScan(client, { id: "s1" });
    expect(r.deleted).toBe(true);
    expect(remove).not.toHaveBeenCalled();
  });

  it("reports storage errors and thrown failures without losing the delete", async () => {
    const a = await deleteSessionAndScan(makeClient({ storageError: "nope" }).client, { id: "s", image_url: "x" });
    expect(a).toEqual({ deleted: true, scanRemoved: false, error: "nope" });
    const b = await deleteSessionAndScan(makeClient({ storageThrows: true }).client, { id: "s", image_url: "x" });
    expect(b).toEqual({ deleted: true, scanRemoved: false, error: "network" });
  });
});
