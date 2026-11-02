-- public.schema_migrations was created by scripts/migrate.mjs without row
-- level security. It sits in the public schema, which PostgREST exposes to the
-- anon key that ships in the browser bundle, so anyone could read it — and,
-- worse, insert a future version number so that migration would be silently
-- skipped, or delete rows so that old migrations re-ran. Supabase's security
-- advisor flagged it as a publicly accessible table.
--
-- Checked before this ran: its 47 rows matched the 47 migration files exactly,
-- so it had not been tampered with.
--
-- RLS on with no policies denies the API roles; the grants are revoked as
-- well. scripts/migrate.mjs connects as the table owner, which bypasses RLS,
-- so migrations keep working. (The script now does the same on start-up.)
alter table public.schema_migrations enable row level security;
revoke all on table public.schema_migrations from anon, authenticated;
