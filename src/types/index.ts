export interface Member {
  id: string;
  full_name: string;
  aliases: string[];
  department?: string;
  phone?: string;
  email?: string;
  created_at: string;
}

export interface AttendanceRecord {
  id: string;
  member_id: string;
  attendance_date: string;
  event_name: string;
  present: boolean;
  created_at: string;
}

export interface Correction {
  id: string;
  incorrect_text: string;
  corrected_member_id: string;
  frequency: number;
  created_at: string;
}

export interface OCRResult {
  text: string;
  confidence: number;
  bbox?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
}

export interface MatchResult {
  ocrName: string;
  columns?: string[]; // Multiple columns from the same row
  emptyCells?: boolean[]; // Structurally suppressed empty cells
  isHeader?: boolean; // If this row is detected as a header
  suggestedMember: Member | null;
  confidence: number;
  ocrConfidence?: number;
  bbox?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  structuralConfidence?: {
    row: number;
    column: number;
    total: number;
  };
  region?: 'title' | 'metadata' | 'header' | 'data' | 'footer' | 'empty';
  semanticConfidence?: number;
  explanation?: string;
  status: 'exact' | 'fuzzy' | 'correction' | 'none' | 'approved' | 'flagged';
  rawOverride?: string;
}

export interface Session {
  id: string;
  event_name: string;
  session_date: string;
  status: 'pending' | 'refining' | 'approved';
  raw_ocr_data: OCRResult[];
  suggested_table: MatchResult[];
  final_table?: MatchResult[];
  image_url?: string;
  created_at: string;
  updated_at: string;
}

export interface SessionVersion {
  id: string;
  session_id: string;
  data: MatchResult[];
  created_at: string;
}
