-- ────────────────────────────────────────────────────────────────────────────
-- Viewer role + auth-required reads
-- Run ONCE in the Supabase SQL editor AFTER roles.sql.
-- Idempotent — safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

-- ── Allow 'viewer' role in admin_users ─────────────────────────────────────
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;
ALTER TABLE admin_users ADD  CONSTRAINT admin_users_role_check
  CHECK (role IN ('master','admin','viewer'));

-- ── Helper functions ────────────────────────────────────────────────────────
-- is_admin = master OR admin (write access)
-- is_master = master (team management)
-- is_member = master OR admin OR viewer (read access)
CREATE OR REPLACE FUNCTION public.is_admin(uid UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM admin_users WHERE user_id = uid AND role IN ('master','admin'));
$$;

CREATE OR REPLACE FUNCTION public.is_master(uid UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM admin_users WHERE user_id = uid AND role = 'master');
$$;

CREATE OR REPLACE FUNCTION public.is_member(uid UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM admin_users WHERE user_id = uid);
$$;

-- ── Updated signup trigger ──────────────────────────────────────────────────
-- The seed master email -> master
-- Anyone @squatwolf.com -> viewer (auto-approved, no waiting)
-- Everyone else -> admin_requests (master must approve)
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e TEXT := lower(NEW.email);
BEGIN
  IF e = 'alexandre.martins@squatwolf.com' THEN
    INSERT INTO admin_users (user_id, email, name, role, added_by)
    VALUES (NEW.id, NEW.email,
            COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)),
            'master', NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  ELSIF e LIKE '%@squatwolf.com' THEN
    INSERT INTO admin_users (user_id, email, name, role, added_by)
    VALUES (NEW.id, NEW.email,
            COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)),
            'viewer', NEW.id)
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

-- (The on_auth_user_created trigger from roles.sql already points at this
--  function — we've just replaced the function body, no trigger change needed.)

-- ── Lock down reads: signed-in members only ─────────────────────────────────
DROP POLICY IF EXISTS "read items"       ON items;
DROP POLICY IF EXISTS "read events"      ON events;
DROP POLICY IF EXISTS "read event_items" ON event_items;
DROP POLICY IF EXISTS "read history"     ON history;
DROP POLICY IF EXISTS "read attachments" ON attachments;

CREATE POLICY "read items"       ON items       FOR SELECT TO authenticated
  USING (public.is_member(auth.uid()));
CREATE POLICY "read events"      ON events      FOR SELECT TO authenticated
  USING (public.is_member(auth.uid()));
CREATE POLICY "read event_items" ON event_items FOR SELECT TO authenticated
  USING (public.is_member(auth.uid()));
CREATE POLICY "read history"     ON history     FOR SELECT TO authenticated
  USING (public.is_member(auth.uid()));
CREATE POLICY "read attachments" ON attachments FOR SELECT TO authenticated
  USING (public.is_member(auth.uid()));

-- Note: the storage bucket "attachments" still has a public-read policy from
-- update-policies.sql, which means uploaded photos are reachable directly via
-- their public URLs (UUID-encoded paths) even by unauthenticated users. The
-- API gate above stops anyone from *enumerating* what exists, so this is a
-- "security through obscurity" gap rather than an open door. Address later
-- by switching to a private bucket + signed URLs if photos contain anything
-- sensitive.
