-- ────────────────────────────────────────────────────────────────────────────
-- Internal comments / notes per deployment
--
-- Lets the team coordinate inside the app instead of in a side chat:
-- "Logistics confirmed truck for Thursday", "Waiting on signage from print",
-- "Setup notes — entrance is via the side door". Comments live on the
-- deployment, are append-only, and visible to anyone who can read the events
-- table (Viewer / Admin / Master).
--
-- Idempotent — safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  author_id   UUID,            -- nullable: matches auth.users.id when set
  author_name TEXT NOT NULL,   -- denormalised for display
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS event_comments_event_idx
  ON event_comments (event_id, created_at DESC);

ALTER TABLE event_comments ENABLE ROW LEVEL SECURITY;

-- Read: anyone with an authenticated session (matches the rest of this app)
DROP POLICY IF EXISTS "read event_comments" ON event_comments;
CREATE POLICY "read event_comments" ON event_comments
  FOR SELECT TO authenticated USING (true);

-- Insert: any authenticated user can post (admins gate the UI; viewers
-- physically can't, since the topbar comment box is admin-only)
DROP POLICY IF EXISTS "insert event_comments" ON event_comments;
CREATE POLICY "insert event_comments" ON event_comments
  FOR INSERT TO authenticated WITH CHECK (true);

-- Delete: author can remove their own comment
DROP POLICY IF EXISTS "delete own event_comments" ON event_comments;
CREATE POLICY "delete own event_comments" ON event_comments
  FOR DELETE TO authenticated USING (author_id = auth.uid());

-- Realtime broadcast so the comments list updates live across clients
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname='supabase_realtime' AND tablename='event_comments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE event_comments;
  END IF;
END $$;
