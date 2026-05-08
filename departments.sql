-- ────────────────────────────────────────────────────────────────────────────
-- Departments involved per deployment
--
-- Lets staff tag which internal departments are participating in a given
-- deployment (Finance, HR, Events & Community, Social Media, Logistics,
-- Expansion, Design, Retail, Founders Content Creator).
--
-- Implemented as a TEXT[] column rather than a join table — the list of
-- departments is small, fixed, and rarely changes; no relational joins
-- are needed. Default empty array so existing rows stay valid.
--
-- Idempotent — safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS departments TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS events_departments_gin_idx
  ON events USING GIN (departments);
