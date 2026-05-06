-- EVENT INVENTORY TRACKER v2 — Run in Supabase SQL editor
-- https://supabase.com/dashboard/project/jnqlhfehhqnhqscvwjxp/sql/new
-- WARNING: drops existing tables and starts fresh

DROP TABLE IF EXISTS attachments CASCADE;
DROP TABLE IF EXISTS history    CASCADE;
DROP TABLE IF EXISTS event_items CASCADE;
DROP TABLE IF EXISTS events     CASCADE;
DROP TABLE IF EXISTS items      CASCADE;

-- ── Master item list ─────────────────────────────────────────────────────────
CREATE TABLE items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  category         TEXT NOT NULL DEFAULT '',
  storage_location TEXT NOT NULL DEFAULT '',
  condition        TEXT NOT NULL DEFAULT 'good' CHECK (condition IN ('good','needs_cleaning','needs_repair','damaged','retired')),
  notes            TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by       TEXT NOT NULL DEFAULT ''
);

-- ── Events ───────────────────────────────────────────────────────────────────
CREATE TABLE events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  event_date   DATE,
  location     TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Items assigned to events ─────────────────────────────────────────────────
CREATE TABLE event_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  item_id             UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'out' CHECK (status IN ('out','returned')),
  current_location    TEXT NOT NULL DEFAULT '',
  condition           TEXT NOT NULL DEFAULT 'good' CHECK (condition IN ('good','needs_cleaning','needs_repair','damaged','retired')),
  notes               TEXT NOT NULL DEFAULT '',
  assigned_by         TEXT NOT NULL DEFAULT '',
  assigned_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  returned_by         TEXT,
  returned_at         TIMESTAMPTZ,
  condition_on_return TEXT CHECK (condition_on_return IS NULL OR condition_on_return IN ('good','needs_cleaning','needs_repair','damaged','retired')),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by          TEXT NOT NULL DEFAULT ''
);

-- ── Full audit trail ─────────────────────────────────────────────────────────
CREATE TABLE history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       UUID REFERENCES items(id) ON DELETE CASCADE,
  event_item_id UUID REFERENCES event_items(id) ON DELETE CASCADE,
  event_id      UUID REFERENCES events(id) ON DELETE CASCADE,
  action        TEXT NOT NULL,
  changes       JSONB NOT NULL DEFAULT '{}',
  changed_by    TEXT NOT NULL,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Photo attachments ────────────────────────────────────────────────────────
CREATE TABLE attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       UUID REFERENCES items(id) ON DELETE CASCADE,
  event_item_id UUID REFERENCES event_items(id) ON DELETE CASCADE,
  storage_path  TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size          BIGINT NOT NULL,
  url           TEXT NOT NULL,
  uploaded_by   TEXT NOT NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX ON event_items(event_id);
CREATE INDEX ON event_items(item_id);
CREATE INDEX ON history(item_id);
CREATE INDEX ON history(event_item_id);
CREATE INDEX ON history(event_id);
CREATE INDEX ON attachments(item_id);
CREATE INDEX ON attachments(event_item_id);

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE history     ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

-- Public read
CREATE POLICY "read items"       ON items       FOR SELECT USING (true);
CREATE POLICY "read events"      ON events      FOR SELECT USING (true);
CREATE POLICY "read event_items" ON event_items FOR SELECT USING (true);
CREATE POLICY "read history"     ON history     FOR SELECT USING (true);
CREATE POLICY "read attachments" ON attachments FOR SELECT USING (true);

-- Admin write
CREATE POLICY "admin insert items"        ON items       FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admin update items"        ON items       FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin delete items"        ON items       FOR DELETE TO authenticated USING (true);

CREATE POLICY "admin insert events"       ON events      FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admin update events"       ON events      FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin delete events"       ON events      FOR DELETE TO authenticated USING (true);

CREATE POLICY "admin insert event_items"  ON event_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admin update event_items"  ON event_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin delete event_items"  ON event_items FOR DELETE TO authenticated USING (true);

CREATE POLICY "admin insert history"      ON history     FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "admin insert attachments"  ON attachments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admin delete attachments"  ON attachments FOR DELETE TO authenticated USING (true);

-- ── Realtime ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='items') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE items;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE events;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='event_items') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE event_items;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='attachments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE attachments;
  END IF;
END $$;

-- ── Storage policies ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public read storage" ON storage.objects;
DROP POLICY IF EXISTS "Auth upload storage" ON storage.objects;
DROP POLICY IF EXISTS "Auth delete storage" ON storage.objects;

CREATE POLICY "Public read storage" ON storage.objects FOR SELECT               USING     (bucket_id = 'attachments');
CREATE POLICY "Auth upload storage" ON storage.objects FOR INSERT  TO authenticated WITH CHECK (bucket_id = 'attachments');
CREATE POLICY "Auth delete storage" ON storage.objects FOR DELETE  TO authenticated USING     (bucket_id = 'attachments');

-- ── Seed demo data ────────────────────────────────────────────────────────────
INSERT INTO items (name, category, storage_location, condition, notes) VALUES
  ('JBL Sound System',       'Audio',     'Warehouse — Shelf A1', 'good',         'Includes 2 speakers + mixer'),
  ('Registration Table (A)', 'Furniture', 'Warehouse — Shelf B2', 'good',         ''),
  ('Cooler #3',              'Equipment', 'Warehouse — Shelf C1', 'needs_repair', 'Lid hinge is loose'),
  ('SQUATWOLF Banner 3m',    'Signage',   'Warehouse — Shelf A3', 'good',         ''),
  ('Prize Box — Volleyball', 'Equipment', 'Warehouse — Office',   'good',         'Locked, key with Faisal'),
  ('Radio #1',               'Comms',     'Warehouse — Shelf D1', 'good',         'Channel 3'),
  ('Radio #2',               'Comms',     'Warehouse — Shelf D1', 'good',         'Channel 3');
