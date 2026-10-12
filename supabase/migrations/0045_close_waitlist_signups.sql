-- The "Dołącz teraz" section on the landing page has been removed, and with it
-- the only thing that ever wrote to these two tables.
--
-- Both carried an INSERT policy for role `public` with `with check (true)`:
-- anyone, signed in or not, could add rows. That was the point while the form
-- existed — it posted straight to PostgREST with the anon key. Without the
-- form it is just an open write endpoint: the anon key ships in the browser
-- bundle, so anyone could keep filling these tables with whatever they liked,
-- and nobody would ever look.
--
-- The tables and the rows already in them are KEPT. RLS stays enabled, so with
-- no INSERT policy left only the service role can write. Bringing the waitlist
-- back is one `create policy` away.
drop policy if exists "allow insert" on public.owner_signups;
drop policy if exists "allow insert" on public.renter_signups;
