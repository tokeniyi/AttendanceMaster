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
  session_id UUID,
  member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  event_name TEXT NOT NULL,
  present BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incorrect_text TEXT NOT NULL UNIQUE,
  corrected_member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  frequency INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS import_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mapping_name TEXT NOT NULL,
  column_mappings JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  session_date DATE DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'pending',
  raw_ocr_data JSONB,
  suggested_table JSONB,
  final_table JSONB,
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS session_id UUID;
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_session_id_fkey;
ALTER TABLE attendance ADD CONSTRAINT attendance_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_session_member_unique ON attendance(session_id, member_id);
CREATE INDEX IF NOT EXISTS idx_members_full_name ON members (full_name);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (attendance_date);
CREATE INDEX IF NOT EXISTS idx_corrections_text ON corrections (incorrect_text);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions (status);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions (session_date);

CREATE OR REPLACE FUNCTION upsert_correction(p_incorrect_text TEXT, p_member_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  INSERT INTO corrections (incorrect_text, corrected_member_id, frequency)
  VALUES (p_incorrect_text, p_member_id, 1)
  ON CONFLICT (incorrect_text) DO UPDATE SET corrected_member_id = EXCLUDED.corrected_member_id, frequency = corrections.frequency + 1;
END;
$$;

CREATE OR REPLACE FUNCTION approve_session(p_session_id UUID, p_rows JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  UPDATE sessions SET final_table = p_rows, suggested_table = p_rows, status = 'approved', updated_at = NOW()
  WHERE id = p_session_id AND owner_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found or not owned by current user'; END IF;

  INSERT INTO attendance (session_id, member_id, attendance_date, event_name, present)
  SELECT p_session_id, (row->'suggestedMember'->>'id')::UUID, s.session_date, s.event_name, COALESCE((row->>'present')::BOOLEAN, TRUE)
  FROM jsonb_array_elements(p_rows) AS row
  JOIN sessions s ON s.id = p_session_id
  WHERE row->'suggestedMember' IS NOT NULL AND row->>'isHeader' IS DISTINCT FROM 'true'
  ON CONFLICT (session_id, member_id) DO UPDATE SET present = EXCLUDED.present, event_name = EXCLUDED.event_name, attendance_date = EXCLUDED.attendance_date;
END;
$$;

ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read/write access" ON members;
DROP POLICY IF EXISTS "Public read/write access" ON attendance;
DROP POLICY IF EXISTS "Public read/write access" ON corrections;
DROP POLICY IF EXISTS "Public read/write access" ON import_mappings;
DROP POLICY IF EXISTS "Public read/write access" ON sessions;
DROP POLICY IF EXISTS "Public read/write access" ON session_versions;

CREATE POLICY "Authenticated users can manage members" ON members FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage corrections" ON corrections FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage import mappings" ON import_mappings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Users can access their own sessions" ON sessions FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Users can access attendance for owned sessions" ON attendance FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM sessions WHERE sessions.id = attendance.session_id AND sessions.owner_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM sessions WHERE sessions.id = attendance.session_id AND sessions.owner_id = auth.uid()));
CREATE POLICY "Users can access versions for owned sessions" ON session_versions FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM sessions WHERE sessions.id = session_versions.session_id AND sessions.owner_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM sessions WHERE sessions.id = session_versions.session_id AND sessions.owner_id = auth.uid()));
