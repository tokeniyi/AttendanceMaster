import Fuse from 'fuse.js';
import { Member, MatchResult, Correction } from '../types';

/**
 * Minimum length before a member id is even considered as a match candidate.
 *
 * `member.id` is a UUID (database/schema.sql:3). OCR of a noisy table cell
 * routinely produces one- or two-character artifacts ("a", "d", "0", "-", "|"),
 * and a substring test against a UUID matches almost any of them. Requiring the
 * OCR text to be at least this long keeps trivial artifacts out of the candidate
 * set entirely.
 */
const MIN_ID_MATCH_LENGTH = 6;

/**
 * Minimum length before text may be offered as a *fuzzy* suggestion.
 *
 * Fuse.js scores are edit-distance ratios, so a SHORT query is scored against a
 * LONG name almost optimistically: with `threshold: 0.35`, a one- or two-character
 * OCR artifact matched a roster member at confidence 0.967-0.996 — higher than
 * genuinely-misread real names such as "Grace Hoppr" (0.695) or "Ada Lovclacc"
 * (0.588). Measured against a 4-member roster, 13 of 22 junk fragments
 * ("a", "Ad", "gh", "Ma", "Lo", ...) resolved to a person at `fuzzy`, while
 * every legitimate match was at least 4 characters.
 *
 * A `minConfidence` floor therefore CANNOT fix this: the two populations overlap
 * heavily (junk 0.967-0.996 vs. legit 0.588-0.760), so any floor low enough to
 * keep real matches keeps all the junk, and any floor high enough to drop the
 * junk discards a third of the real ones. Length is the axis that actually
 * separates them, so it is the axis that is gated.
 *
 * At this value all 13 junk fragments are rejected while all 13 legitimate
 * short names ("Adaa", "Grah", "Hoppr", "Ada L") still resolve. Raising it to 5
 * would start rejecting real short names without rejecting any additional junk.
 *
 * Rejecting yields `status: 'none'` — no suggestion — so the row is left for the
 * operator rather than being pre-filled with the wrong person.
 */
const MIN_FUZZY_MATCH_LENGTH = 3;

export function matchMembers(
  ocrNames: string[],
  members: Member[],
  pastCorrections: Correction[]
): MatchResult[] {
  const fuseOptions = {
    keys: [
      { name: 'full_name', weight: 0.7 },
      { name: 'aliases', weight: 0.3 }
    ],
    threshold: 0.35, // More strict for better accuracy
    includeScore: true,
    ignoreLocation: true, // Names can be anywhere in the string
  };

  const fuse = new Fuse(members, fuseOptions);

  // Map corrections for quick lookup
  const correctionsMap = new Map<string, string>();
  pastCorrections.forEach(c => {
    correctionsMap.set(c.incorrect_text.toLowerCase(), c.corrected_member_id);
  });

  return ocrNames.map(ocrName => {
    const lowerName = ocrName.toLowerCase();

    // 0. Check for exact match first (most reliable).
    //
    // A name or alias match is authoritative: the OCR text is the whole label.
    //
    // An id match must be ANCHORED — the OCR text has to equal the entire id.
    // The previous `m.id.toLowerCase().includes(lowerName)` treated any OCR
    // fragment that happened to appear anywhere inside a UUID as a 1.0-confidence
    // exact match, which flowed straight into suggested_table -> approve_session
    // as a wrong-person attendance row presented to the operator as maximally
    // trustworthy. A substring test against a UUID has no correct form; the only
    // safe version is whole-id equality, which is also total (at most one member
    // can own a given id).
    const idIsCandidate = lowerName.length >= MIN_ID_MATCH_LENGTH;
    const exactMatch = members.find(
      m => m.full_name.toLowerCase() === lowerName ||
           m.aliases.some(a => a.toLowerCase() === lowerName) ||
           (idIsCandidate && m.id.toLowerCase() === lowerName)
    );
    if (exactMatch) {
      return {
        ocrName,
        suggestedMember: exactMatch,
        confidence: 1.0,
        status: 'exact',
      };
    }

    // 1. Check for learned corrections
    const correctedId = correctionsMap.get(lowerName);
    if (correctedId) {
      const member = members.find(m => m.id === correctedId);
      if (member) {
        return {
          ocrName,
          suggestedMember: member,
          confidence: 1.0,
          status: 'correction',
        };
      }
    }

    // 2. Fuzzy match
    //
    // Gated on length, not on confidence: a short OCR artifact scores HIGHER
    // against a long name than a genuinely misread real name does, so a
    // confidence floor would reject the real matches and keep the junk. See
    // MIN_FUZZY_MATCH_LENGTH.
    const results = lowerName.length >= MIN_FUZZY_MATCH_LENGTH
      ? fuse.search(ocrName)
      : [];
    if (results.length > 0) {
      const bestMatch = results[0];
      return {
        ocrName,
        suggestedMember: bestMatch.item,
        confidence: 1 - (bestMatch.score || 0),
        status: 'fuzzy',
      };
    }

    return {
      ocrName,
      suggestedMember: null,
      confidence: 0,
      status: 'none',
    };
  });
}