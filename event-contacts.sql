-- ────────────────────────────────────────────────────────────────────────────
-- Per-deployment contacts
--
-- Lets staff store the people relevant to each event — venue manager,
-- logistics driver, vendor PoCs, internal owners — directly on the
-- deployment so they're one tap away on mobile (tel: / mailto: links).
--
-- Idempotent — safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  TEXT
);

CREATE INDEX IF NOT EXISTS event_contacts_event_idx
  ON event_contacts (event_id, created_at);

ALTER TABLE event_contacts ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user (matches the rest of this app)
DROP POLICY IF EXISTS "read event_contacts" ON event_contacts;
CREATE POLICY "read event_contacts" ON event_contacts
  FOR SELECT TO authenticated USING (true);

-- Write: any authenticated user; UI gates these to admin role
DROP POLICY IF EXISTS "insert event_contacts" ON event_contacts;
CREATE POLICY "insert event_contacts" ON event_contacts
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update event_contacts" ON event_contacts;
CREATE POLICY "update event_contacts" ON event_contacts
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete event_contacts" ON event_contacts;
CREATE POLICY "delete event_contacts" ON event_contacts
  FOR DELETE TO authenticated USING (true);

-- Realtime broadcast so the sidebar updates live across clients
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname='supabase_realtime' AND tablename='event_contacts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE event_contacts;
  END IF;
END $$;
