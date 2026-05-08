-- ────────────────────────────────────────────────────────────────────────────
-- Date ranges + logistics metadata
--
-- Original sin: events had a single event_date (DATE). Real activations span
-- 2-14 days (Thu setup → Fri/Sat/Sun open → Mon load-out). Calendar / overdue
-- alerts / "expected back" all need start + end + load-in/out windows.
--
-- This migration:
--   1. Adds event_start_date / event_end_date / load_in_at / load_out_at to
--      events (TIMESTAMPTZ for the load times so they include hour-of-day —
--      "load-in 6–10am" is a real UAE mall constraint).
--   2. Adds venue_access_notes (free text — gate passes, dock height, lift
--      restrictions) + driver_name + vehicle_plate.
--   3. Adds expected_return_date to event_items so per-item return dates can
--      diverge from the deployment default (cross-docking, repairs, loans).
--   4. Backfills event_start_date = event_end_date = event_date for existing
--      rows so the new fields are populated for historical events.
--
-- Idempotent — safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Date range + load windows on events
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS event_start_date    DATE,
  ADD COLUMN IF NOT EXISTS event_end_date      DATE,
  ADD COLUMN IF NOT EXISTS load_in_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS load_out_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS venue_access_notes  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS driver_name         TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS vehicle_plate       TEXT NOT NULL DEFAULT '';

-- 2. Backfill the new dates from the legacy single event_date so the calendar
--    has data to render for historical deployments.
UPDATE events
   SET event_start_date = event_date
 WHERE event_start_date IS NULL AND event_date IS NOT NULL;

UPDATE events
   SET event_end_date = event_date
 WHERE event_end_date IS NULL AND event_date IS NOT NULL;

-- 3. Per-item expected return — for the rare case where one item stays out
--    longer than the deployment (sent for repair, going to next event, on
--    loan). 90% inherit the event's load_out_at; this column captures the 10%.
ALTER TABLE event_items
  ADD COLUMN IF NOT EXISTS expected_return_date TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS event_items_expected_return_idx
  ON event_items (expected_return_date) WHERE status = 'out';
CREATE INDEX IF NOT EXISTS events_date_range_idx
  ON events (event_start_date, event_end_date);
