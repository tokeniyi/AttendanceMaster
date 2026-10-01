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
    const results = fuse.search(ocrName);
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