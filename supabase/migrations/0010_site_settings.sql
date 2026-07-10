-- Singleton settings row — lets admin flip a site-wide maintenance mode
-- that hides all car listings from the public without touching any car.
create table public.site_settings (
  id int primary key default 1,
  maintenance_mode boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint site_settings_single_row check (id = 1)
);

insert into public.site_settings (id, maintenance_mode) values (1, false);

alter table public.site_settings enable row level security;

-- readable by everyone (public pages need to check it), writable by admins only
create policy "site_settings_select_all"
  on public.site_settings for select
  using (true);

create policy "site_settings_update_admin"
  on public.site_settings for update
  using (public.is_admin());

create trigger on_site_settings_updated
  before update on public.site_settings
  for each row execute function public.set_updated_at();
