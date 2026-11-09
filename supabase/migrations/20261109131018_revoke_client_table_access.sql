-- Browser clients use fleet-api; internal tables are not a second client API.
-- Keep service_role access and all data unchanged.
revoke all privileges on all tables in schema public from public, anon, authenticated;
revoke all privileges on all sequences in schema public from public, anon, authenticated;

-- Defense in depth against accidentally restoring the old table grants.
-- The Edge Functions access these tables with the server-only service_role.
drop policy if exists fleet_companies_member_read on public.fleet_companies;
drop policy if exists fleet_members_self_read on public.fleet_members;
drop policy if exists fleet_records_member_read on public.fleet_records;

-- Migrations create application objects as postgres. New tables and sequences
-- must require explicit client grants, paired with narrowly scoped RLS policies.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public, anon, authenticated;
