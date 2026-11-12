import Papa from 'papaparse';
import { Member, AttendanceRecord } from '../types';

export function parseMemberCSV(file: File): Promise<Partial<Member>[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        resolve(results.data as Partial<Member>[]);
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
