import Fuse from 'fuse.js';
import { Member, MatchResult, Correction } from '../types';

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

    // 2. Exact match (including numerical ID check)
    const exactMatch = members.find(
      m => m.full_name.toLowerCase() === lowerName || 
           m.aliases.some(a => a.toLowerCase() === lowerName) ||
           m.id.toLowerCase().includes(lowerName) // Check if the OCR text is part of the ID
    );
    if (exactMatch) {
      return {
        ocrName,
        suggestedMember: exactMatch,
        confidence: 1.0,
        status: 'exact',
      };
    }

    // 3. Fuzzy match
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
