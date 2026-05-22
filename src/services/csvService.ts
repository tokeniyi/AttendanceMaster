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

export function exportAttendanceCSV(records: (AttendanceRecord & { member_name: string })[]) {
  const csv = Papa.unparse(records);
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
