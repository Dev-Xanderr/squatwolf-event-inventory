-- ────────────────────────────────────────────────────────────────────────────
-- Roles migration — adds tiered access (master / admin / guest)
-- Run this ONCE in the Supabase SQL editor AFTER schema-v2.sql + update-policies.sql
-- Idempotent: safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

-- ── Roles tables ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_users (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('master','admin')),
  added_by   UUID REFERENCES auth.users(id),
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  name         TEXT NOT NULL DEFAULT '',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  reviewed_by  UUID REFERENCES auth.users(id),
  reviewed_at  TIMESTAMPTZ,
  note         TEXT NOT NULL DEFAULT ''
);

ALTER TABLE admin_users    ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_requests ENABLE ROW LEVEL SECURITY;

-- ── Auto-handler on signup ──────────────────────────────────────────────────
-- The seed master email becomes 'master' automatically on first signup.
-- Everyone else is queued in admin_requests for a master to approve.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF lower(NEW.email) = 'alexandre.martins@squatwolf.com' THEN
    INSERT INTO admin_users (user_id, email, name, role, added_by)
    VALUES (NEW.id, NEW.email,
            COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
            'master', NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  ELSE
    INSERT INTO admin_requests (user_id, email, name)
    VALUES (NEW.id, NEW.email,
            COALESCE(NEW.raw_user_meta_data->>'name', ''))
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Helper: am I an admin? am I a master? ───────────────────────────────────
-- Wrapped as SECURITY DEFINER functions so RLS subqueries don't recurse.
CREATE OR REPLACE FUNCTION public.is_admin(uid UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM admin_users WHERE user_id = uid);
$$;

CREATE OR REPLACE FUNCTION public.is_master(uid UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM admin_users WHERE user_id = uid AND role = 'master');
$$;

-- ── Policies on admin_users ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "read admin_users"         ON admin_users;
DROP POLICY IF EXISTS "master writes admin_users" ON admin_users;
DROP POLICY IF EXISTS "master inserts admin_users" ON admin_users;
DROP POLICY IF EXISTS "master updates admin_users" ON admin_users;
DROP POLICY IF EXISTS "master deletes admin_users" ON admin_users;

-- Public read: it's just "who are the admins" — same trust model as the rest of the app.
CREATE POLICY "read admin_users" ON admin_users FOR SELECT USING (true);

-- Only masters can mutate admin_users. Splitting INSERT / UPDATE / DELETE so the
-- WITH CHECK and USING clauses are explicit.
CREATE POLICY "master inserts admin_users" ON admin_users FOR INSERT TO authenticated
  WITH CHECK (public.is_master(auth.uid()));
CREATE POLICY "master updates admin_users" ON admin_users FOR UPDATE TO authenticated
  USING      (public.is_master(auth.uid()))
  WITH CHECK (public.is_master(auth.uid()));
CREATE POLICY "master deletes admin_users" ON admin_users FOR DELETE TO authenticated
  USING      (public.is_master(auth.uid()));

-- ── Policies on admin_requests ──────────────────────────────────────────────
DROP POLICY IF EXISTS "self or master reads requests" ON admin_requests;
DROP POLICY IF EXISTS "master updates requests"       ON admin_requests;
DROP POLICY IF EXISTS "master deletes requests"       ON admin_requests;

-- A user can read their own pending request; masters can read all.
CREATE POLICY "self or master reads requests" ON admin_requests FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_master(auth.uid()));

CREATE POLICY "master updates requests" ON admin_requests FOR UPDATE TO authenticated
  USING      (public.is_master(auth.uid()))
  WITH CHECK (public.is_master(auth.uid()));

CREATE POLICY "master deletes requests" ON admin_requests FOR DELETE TO authenticated
  USING      (public.is_master(auth.uid()));

-- ── Rewrite write policies on inventory tables ──────────────────────────────
-- Drop the existing "TO authenticated WITH CHECK (true)" policies and
-- replace with admin-membership-aware ones.
DROP POLICY IF EXISTS "admin insert items"        ON items;
DROP POLICY IF EXISTS "admin update items"        ON items;
DROP POLICY IF EXISTS "admin delete items"        ON items;
DROP POLICY IF EXISTS "admin insert events"       ON events;
DROP POLICY IF EXISTS "admin update events"       ON events;
DROP POLICY IF EXISTS "admin delete events"       ON events;
DROP POLICY IF EXISTS "admin insert event_items"  ON event_items;
DROP POLICY IF EXISTS "admin update event_items"  ON event_items;
DROP POLICY IF EXISTS "admin delete event_items"  ON event_items;
DROP POLICY IF EXISTS "admin insert history"      ON history;
DROP POLICY IF EXISTS "admin insert attachments"  ON attachments;
DROP POLICY IF EXISTS "admin delete attachments"  ON attachments;

CREATE POLICY "admin insert items"       ON items       FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "admin update items"       ON items       FOR UPDATE TO authenticated
  USING      (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "admin delete items"       ON items       FOR DELETE TO authenticated
  USING      (public.is_admin(auth.uid()));

CREATE POLICY "admin insert events"      ON events      FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "admin update events"      ON events      FOR UPDATE TO authenticated
  USING      (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "admin delete events"      ON events      FOR DELETE TO authenticated
  USING      (public.is_admin(auth.uid()));

CREATE POLICY "admin insert event_items" ON event_items FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "admin update event_items" ON event_items FOR UPDATE TO authenticated
  USING      (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "admin delete event_items" ON event_items FOR DELETE TO authenticated
  USING      (public.is_admin(auth.uid()));

CREATE POLICY "admin insert history"     ON history     FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "admin insert attachments" ON attachments FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "admin delete attachments" ON attachments FOR DELETE TO authenticated
  USING      (public.is_admin(auth.uid()));
