import type { MatchResult } from "@/types";

export function approvalRows(rows: MatchResult[]) {
  return rows.filter(row => Boolean(row.suggestedMember) && !row.isHeader);
}

export interface ReviewProgress {
  /** Rows that could become an attendance row: a real member, not a header. */
  eligible: number;
  /** Eligible rows the operator explicitly approved. */
  approved: number;
  /** Eligible rows the operator explicitly flagged as wrong. */
  flagged: number;
  /** Eligible rows the operator has neither approved nor flagged. */
  unresolved: number;
  /** Percentage of eligible rows that carry an explicit operator decision. */
  progressPct: number;
  /** True when no eligible row is left undecided. */
  complete: boolean;
}

/**
 * A row is "eligible" when `approve_session` could turn it into an attendance row:
 * it is not a header and it carries a member. Those are exactly the rows whose
 * presence or absence in `attendance` is a factual claim about a real person, so
 * an operator decision is required before the session is finalized.
 *
 * Rows with no member are excluded on purpose: the SQL cannot write them, so an
 * unresolved `status: 'none'` row must not deadlock the finalize gate.
 */
export function reviewProgress(rows: MatchResult[]): ReviewProgress {
  const eligible = approvalRows(rows);

  let approved = 0;
  let flagged = 0;
  let unresolved = 0;

  for (const row of eligible) {
    if (row.status === "approved") approved++;
    else if (row.status === "flagged") flagged++;
    else unresolved++;
  }

  const decided = approved + flagged;

  return {
    eligible: eligible.length,
    approved,
    flagged,
    unresolved,
    progressPct: eligible.length === 0 ? 100 : (decided / eligible.length) * 100,
    complete: unresolved === 0,
  };
}

/**
 * Finalizing writes `present = TRUE` for every eligible row it can, so an
 * unreviewed row is silently recorded as present. The gate refuses until every
 * eligible row is either approved or flagged.
 */
export function canFinalize(rows: MatchResult[]): boolean {
  return reviewProgress(rows).complete;
}
