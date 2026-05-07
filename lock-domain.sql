-- ────────────────────────────────────────────────────────────────────────────
-- Restrict signups to @squatwolf.com only
-- Run ONCE in the Supabase SQL editor AFTER viewer-role.sql.
-- Idempotent — safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

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
    -- Hard-reject non-squatwolf signups. Aborts the auth.users INSERT so no
    -- account is created at all. The client-side flow also blocks this
    -- earlier for nicer UX, but this is the real gate.
    RAISE EXCEPTION 'Sign-up restricted to @squatwolf.com email addresses';
  END IF;
  RETURN NEW;
END;
$$;
-- Trigger from roles.sql still references this function — no trigger change needed.
