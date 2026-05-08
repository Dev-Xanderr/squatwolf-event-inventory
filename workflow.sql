-- ────────────────────────────────────────────────────────────────────────────
-- Deployment workflow state machine
--
-- Adds a per-event lifecycle:
--   draft  →  requested  →  approved  →  shipped  →  arrived  →  returning  →  closed
--                       └→  draft (sent back for revision)
--
-- Existing rows default to 'approved' so historical events skip the new
-- request gate and stay in their previous "items already assigned" state.
-- New events created via the JS modal explicitly start at 'draft'.
--
-- Idempotent — safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS workflow_state TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS workflow_updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS workflow_updated_by TEXT;

-- Drop existing CHECK if present (older migration runs may have added one);
-- then re-add with the canonical state set so re-runs are safe.
DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT conname INTO con_name
    FROM pg_constraint
    WHERE conrelid = 'events'::regclass
      AND conname  = 'events_workflow_state_check';
  IF con_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE events DROP CONSTRAINT ' || con_name;
  END IF;
END $$;

ALTER TABLE events
  ADD CONSTRAINT events_workflow_state_check
  CHECK (workflow_state IN ('draft','requested','approved','shipped','arrived','returning','closed'));

CREATE INDEX IF NOT EXISTS events_workflow_state_idx ON events (workflow_state);
