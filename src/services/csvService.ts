import Papa from 'papaparse';
import { Member, AttendanceRecord } from '../types';

/**
 * Normalise raw CSV rows into insertable member rows. Only known columns are kept
 * (unknown/extra columns such as `id` or `owner_id` are dropped so an uploaded file
 * cannot set arbitrary fields), values are trimmed, rows without a full_name are skipped,
 * malformed emails are dropped, duplicate names (case-insensitive) are skipped, and `aliases` (separated by `;` or `|`) become a string array.
 */
export function sanitizeMemberRows(rows: Record<string, unknown>[]): Partial<Member>[] {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const out: Partial<Member>[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const full_name = str(row.full_name);
    if (!full_name) continue;
    // Skip duplicate names within the same file (case/whitespace-insensitive).
    const key = full_name.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    const member: Partial<Member> = {
      full_name,
      aliases: str(row.aliases).split(/[;|]/).map(a => a.trim()).filter(Boolean),
    };
    const department = str(row.department);
    const email = str(row.email);
    if (department) member.department = department;
    // Drop malformed emails rather than storing junk.
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) member.email = email;
    out.push(member);
  }
  return out;
}

export function parseMemberCSV(file: File): Promise<Partial<Member>[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
      complete: (results) => {
        resolve(sanitizeMemberRows(results.data));
      },
      error: (error) => {
        reject(error);
      }
    });
  });
}

/**
 * Serialise rows to CSV with spreadsheet-formula neutralisation. OCR text and member
 * names are untrusted: a cell starting with = + - @ (or tab/CR) would execute as a
 * formula when the file is opened in Excel/Sheets (CSV injection). `escapeFormulae`
 * prefixes such cells with a single quote so they are treated as text.
 */
export function toSafeCSV(rows: unknown[], config: Papa.UnparseConfig = {}): string {
  return Papa.unparse(rows, { ...config, escapeFormulae: true });
}

export function exportAttendanceCSV(records: (AttendanceRecord & { member_name: string })[]) {
  const csv = toSafeCSV(records);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `attendance_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
