import type { MatchResult } from "@/types";

export function approvalRows(rows: MatchResult[]) {
  return rows.filter(row => Boolean(row.suggestedMember) && !row.isHeader);
}
