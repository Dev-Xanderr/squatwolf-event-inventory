-- ── Condition CHECK constraints (idempotent) ────────────────────────────────
-- Keeps the allowed condition values aligned with the app:
--   good · needs_cleaning · needs_repair · damaged · retired
DO $$ BEGIN
  ALTER TABLE items       DROP CONSTRAINT IF EXISTS items_condition_check;
  ALTER TABLE items       ADD  CONSTRAINT items_condition_check
        CHECK (condition IN ('good','needs_cleaning','needs_repair','damaged','retired'));
  ALTER TABLE event_items DROP CONSTRAINT IF EXISTS event_items_condition_check;
  ALTER TABLE event_items ADD  CONSTRAINT event_items_condition_check
        CHECK (condition IN ('good','needs_cleaning','needs_repair','damaged','retired'));
  ALTER TABLE event_items DROP CONSTRAINT IF EXISTS event_items_condition_on_return_check;
  ALTER TABLE event_items ADD  CONSTRAINT event_items_condition_on_return_check
        CHECK (condition_on_return IS NULL OR condition_on_return IN ('good','needs_cleaning','needs_repair','damaged','retired'));
END $$;

-- Clear old policies
DROP POLICY IF EXISTS "public read events" ON events;
DROP POLICY IF EXISTS "public read items" ON items;
DROP POLICY IF EXISTS "public read history" ON history;
DROP POLICY IF EXISTS "public read attachments" ON attachments;

-- Public read (anyone with the link)
CREATE POLICY "read events"      ON events      FOR SELECT USING (true);
CREATE POLICY "read items"       ON items       FOR SELECT USING (true);
CREATE POLICY "read history"     ON history     FOR SELECT USING (true);
CREATE POLICY "read attachments" ON attachments FOR SELECT USING (true);

-- Admin write (logged-in admins only)
CREATE POLICY "admin insert events"      ON events      FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admin insert items"       ON items       FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admin update items"       ON items       FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin delete items"       ON items       FOR DELETE TO authenticated USING (true);
CREATE POLICY "admin insert history"     ON history     FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admin insert attachments" ON attachments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admin delete attachments" ON attachments FOR DELETE TO authenticated USING (true);

-- Realtime (safe — skips if already added)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE events;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='items') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE items;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='attachments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE attachments;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='event_items') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE event_items;
  END IF;
END $$;

-- Storage policies
DROP POLICY IF EXISTS "Public read storage" ON storage.objects;
DROP POLICY IF EXISTS "Auth upload storage" ON storage.objects;
DROP POLICY IF EXISTS "Auth delete storage" ON storage.objects;

CREATE POLICY "Public read storage" ON storage.objects FOR SELECT               USING     (bucket_id = 'attachments');
CREATE POLICY "Auth upload storage" ON storage.objects FOR INSERT  TO authenticated WITH CHECK (bucket_id = 'attachments');
CREATE POLICY "Auth delete storage" ON storage.objects FOR DELETE  TO authenticated USING     (bucket_id = 'attachments');
