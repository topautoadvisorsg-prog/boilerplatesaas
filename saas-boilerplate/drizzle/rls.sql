-- Row-Level Security policies.
-- Applied via `pnpm db:rls` (scripts/apply-rls.ts) AFTER migrations.
-- The withTenant() helper sets `app.current_tenant_id` per transaction;
-- these policies use it to filter every tenant-scoped query automatically.

-- Helper to read the current tenant id (returns NULL if unset → policy denies).
CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid;
$$;

-- ---------------------------------------------------------------------
-- tenant_members
-- ---------------------------------------------------------------------
ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_members FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tm_tenant_isolation ON tenant_members;
CREATE POLICY tm_tenant_isolation ON tenant_members
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

-- ---------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sub_tenant_isolation ON subscriptions;
CREATE POLICY sub_tenant_isolation ON subscriptions
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

-- ---------------------------------------------------------------------
-- invitations
-- ---------------------------------------------------------------------
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inv_tenant_isolation ON invitations;
CREATE POLICY inv_tenant_isolation ON invitations
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

-- ---------------------------------------------------------------------
-- user_regions
-- ---------------------------------------------------------------------
ALTER TABLE user_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_regions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ur_tenant_isolation ON user_regions;
CREATE POLICY ur_tenant_isolation ON user_regions
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

-- Note: `regions` is intentionally NOT enabled for RLS — it is a global
-- catalog readable by all tenants. Tenants opt into specific regions via
-- tenant_settings.enabled_region_ids (application-level filter).

-- Note: `global_decks` and `global_cards` are also GLOBAL (no RLS). Every
-- tenant reads from the same canonical catalog and only writes to their
-- own `tenant_decks` / `tenant_cards` fork when customizing.

-- ---------------------------------------------------------------------
-- tenant_decks
-- ---------------------------------------------------------------------
ALTER TABLE tenant_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_decks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS td_tenant_isolation ON tenant_decks;
CREATE POLICY td_tenant_isolation ON tenant_decks
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

-- ---------------------------------------------------------------------
-- tenant_cards
-- ---------------------------------------------------------------------
ALTER TABLE tenant_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_cards FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tc_tenant_isolation ON tenant_cards;
CREATE POLICY tc_tenant_isolation ON tenant_cards
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

-- ---------------------------------------------------------------------
-- audit_logs (tenant_id is NULLABLE for global events; allow NULL rows
-- to bypass the policy so admin/system writes still work).
-- ---------------------------------------------------------------------
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_tenant_isolation ON audit_logs;
CREATE POLICY audit_tenant_isolation ON audit_logs
  USING (tenant_id IS NULL OR tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id IS NULL OR tenant_id = app_current_tenant_id());

-- ---------------------------------------------------------------------
-- BYPASS NOTE
-- ---------------------------------------------------------------------
-- The Drizzle client connects with the role that owns these tables, which
-- by default bypasses RLS via implicit BYPASSRLS or table ownership.
-- For TRUE enforcement in production:
--   1) Create a dedicated app role:
--        CREATE ROLE app_user NOLOGIN;
--        GRANT USAGE ON SCHEMA public TO app_user;
--        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
--   2) Connect from Drizzle using a connection string whose user is `app_user`
--      (not the migration owner). The FORCE ROW LEVEL SECURITY above ensures
--      even the table owner is restricted when using this connection.
--   3) Admin / migration tooling continues to use the owner connection
--      (DATABASE_URL_UNPOOLED) which bypasses RLS, as intended.
