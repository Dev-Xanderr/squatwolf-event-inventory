-- Run this once in your Supabase SQL editor:
-- https://supabase.com/dashboard/project/jnqlhfehhqnhqscvwjxp/sql/new

-- ── Drop old server-side policies ──────────────────────────────────────────
DROP POLICY IF EXISTS "public read events" ON events;
DROP POLICY IF EXISTS "public read items" ON items;
DROP POLICY IF EXISTS "public read history" ON history;
DROP POLICY IF EXISTS "public read attachments" ON attachments;

-- ── Public read (no login required) ────────────────────────────────────────
CREATE POLICY "read events"      ON events      FOR SELECT USING (true);
CREATE POLICY "read items"       ON items       FOR SELECT USING (true);
CREATE POLICY "read history"     ON history     FOR SELECT USING (true);
CREATE POLICY "read attachments" ON attachments FOR SELECT USING (true);

-- ── Admin write (must be logged in) ────────────────────────────────────────
CREATE POLICY "admin insert events"      ON events      FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admin insert items"       ON items       FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admin update items"       ON items       FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin delete items"       ON items       FOR DELETE TO authenticated USING (true);
CREATE POLICY "admin insert history"     ON history     FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admin insert attachments" ON attachments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admin delete attachments" ON attachments FOR DELETE TO authenticated USING (true);

-- ── Realtime (live updates across devices) ──────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE events;
ALTER PUBLICATION supabase_realtime ADD TABLE items;
ALTER PUBLICATION supabase_realtime ADD TABLE attachments;

-- ── Storage bucket policies ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public read storage"  ON storage.objects;
DROP POLICY IF EXISTS "Auth upload storage"  ON storage.objects;
DROP POLICY IF EXISTS "Auth delete storage"  ON storage.objects;

CREATE POLICY "Public read storage"  ON storage.objects FOR SELECT               USING     (bucket_id = 'attachments');
CREATE POLICY "Auth upload storage"  ON storage.objects FOR INSERT  TO authenticated WITH CHECK (bucket_id = 'attachments');
CREATE POLICY "Auth delete storage"  ON storage.objects FOR DELETE  TO authenticated USING     (bucket_id = 'attachments');
