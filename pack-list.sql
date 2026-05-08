-- ────────────────────────────────────────────────────────────────────────────
-- Pack-list checkpoint for event_items
--
-- Items currently flip straight from "stored" → status='out' the moment they're
-- assigned to a deployment. There's no in-between for "I've physically loaded
-- this onto the truck" vs. "this is just on the assignment list."
--
-- This migration adds two nullable columns that layer on top of existing
-- status without breaking it: an item is "packed" when packed_at IS NOT NULL.
-- Status remains the workflow state (out / returned); packed is a flag.
--
-- Idempotent — safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE event_items
  ADD COLUMN IF NOT EXISTS packed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS packed_by TEXT;

-- index helps the dashboard's pack-progress query per upcoming event
CREATE INDEX IF NOT EXISTS event_items_event_packed_idx
  ON event_items (event_id) WHERE packed_at IS NOT NULL;
