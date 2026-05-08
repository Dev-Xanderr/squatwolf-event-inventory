-- ────────────────────────────────────────────────────────────────────────────
-- Hour-of-day precision on event start / end
--
-- The DATE columns event_start_date / event_end_date can't say "Friday 10:00 →
-- Saturday 22:00" — only "Friday → Saturday". For multi-day mall pop-ups and
-- arena activations, opening and closing times matter (and differ from
-- load-in / load-out, which already use TIMESTAMPTZ).
--
-- This migration:
--   1. Adds event_start_at + event_end_at as TIMESTAMPTZ
--   2. Backfills from existing start_date / end_date with sensible defaults
--      (10:00 local for opens, 22:00 local for closes — UAE retail-typical)
--   3. Leaves event_start_date / event_end_date in place for back-compat;
--      the app prefers the _at fields when present.
--
-- Idempotent — safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS event_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS event_end_at   TIMESTAMPTZ;

-- Backfill from DATE columns. Postgres treats `DATE + INTERVAL '10 hours'`
-- as a TIMESTAMP (without TZ), then cast to TIMESTAMPTZ which interprets in
-- the database session's TZ.
UPDATE events
   SET event_start_at = (event_start_date::timestamp + INTERVAL '10 hours')::timestamptz
 WHERE event_start_at IS NULL AND event_start_date IS NOT NULL;

UPDATE events
   SET event_end_at = (event_end_date::timestamp + INTERVAL '22 hours')::timestamptz
 WHERE event_end_at IS NULL AND event_end_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS events_start_at_idx ON events (event_start_at);
CREATE INDEX IF NOT EXISTS events_end_at_idx   ON events (event_end_at);
