-- Members Table
CREATE TABLE IF NOT EXISTS members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  aliases TEXT[] DEFAULT '{}',
  department TEXT,
  phone TEXT,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Attendance Table
CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  event_name TEXT NOT NULL,
  present BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Corrections Table (for smart matching)
CREATE TABLE IF NOT EXISTS corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incorrect_text TEXT NOT NULL UNIQUE,
  corrected_member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  frequency INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Import Mappings
CREATE TABLE IF NOT EXISTS import_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mapping_name TEXT NOT NULL,
  column_mappings JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sessions Table (Organizational Memory)
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  session_date DATE DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'pending', -- 'pending', 'refining', 'approved'
  raw_ocr_data JSONB, -- Intermediate OCR results
  suggested_table JSONB, -- AI's current best guess
  final_table JSONB, -- Final approved data
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Session Versions (Audit Trail)
CREATE TABLE IF NOT EXISTS session_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices for faster matching and history lookups
CREATE INDEX IF NOT EXISTS idx_members_full_name ON members (full_name);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (attendance_date);
CREATE INDEX IF NOT EXISTS idx_corrections_text ON corrections (incorrect_text);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions (status);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions (session_date);

-- RPC for upserting corrections
-- This function handles the learning logic for the matching engine
CREATE OR REPLACE FUNCTION upsert_correction(p_incorrect_text TEXT, p_member_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO corrections (incorrect_text, corrected_member_id, frequency)
  VALUES (p_incorrect_text, p_member_id, 1)
  ON CONFLICT (incorrect_text)
  DO UPDATE SET 
    corrected_member_id = EXCLUDED.corrected_member_id,
    frequency = corrections.frequency + 1;
END;
$$ LANGUAGE plpgsql;
-- Enable RLS
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_versions ENABLE ROW LEVEL SECURITY;

-- Simple public policies for MVP (allow anon access)
CREATE POLICY "Public read/write access" ON members FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read/write access" ON attendance FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read/write access" ON corrections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read/write access" ON sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read/write access" ON session_versions FOR ALL USING (true) WITH CHECK (true);
