create extension if not exists pgcrypto;

create type public.app_role as enum (
  'A',
  'B',
  'C',
  'D'
);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null,
  role public.app_role,
  created_at timestamptz not null default now()
);

create function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role::text
  from public.profiles p
  where p.user_id = (select auth.uid())
$$;

revoke all on function public.current_app_role() from public;
grant execute on function public.current_app_role() to authenticated;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(new.email, '@', 1)
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create function public.set_requester_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select coalesce(p.display_name, p.email)
  into new.requester_name
  from public.profiles p
  where p.user_id = new.requester_id;

  if new.requester_name is null then
    raise exception 'Requester profile does not exist';
  end if;

  return new;
end;
$$;

create table public.stock_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique,
  requester_id uuid not null references auth.users (id) on delete restrict,
  requester_name text not null,
  item_name text not null check (length(trim(item_name)) between 1 and 200),
  quantity integer not null check (quantity > 0),
  unit text not null check (length(trim(unit)) between 1 and 50),
  purpose text not null default '' check (length(purpose) <= 240),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'unavailable')),
  note text not null default '',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create trigger set_stock_requester_name
  before insert on public.stock_requests
  for each row execute procedure public.set_requester_name();

create index stock_requests_status_created_at_idx
  on public.stock_requests (status, created_at desc);
create index stock_requests_requester_created_at_idx
  on public.stock_requests (requester_id, created_at desc);

create table public.gatepasses (
  id uuid primary key default gen_random_uuid(),
  gatepass_number text not null unique,
  requester_id uuid not null references auth.users (id) on delete restrict,
  requester_name text not null,
  item_name text not null check (length(trim(item_name)) between 1 and 200),
  quantity integer not null check (quantity > 0),
  unit text not null check (length(trim(unit)) between 1 and 50),
  destination text not null check (length(trim(destination)) between 1 and 200),
  purpose text not null default '' check (length(purpose) <= 240),
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create trigger set_gatepass_requester_name
  before insert on public.gatepasses
  for each row execute procedure public.set_requester_name();

create index gatepasses_status_created_at_idx
  on public.gatepasses (status, created_at desc);
create index gatepasses_requester_created_at_idx
  on public.gatepasses (requester_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.stock_requests enable row level security;
alter table public.gatepasses enable row level security;

grant select on public.profiles to authenticated;
grant select, delete on public.stock_requests to authenticated;
grant insert (request_number, requester_id, requester_name, item_name, quantity, unit, purpose, status)
  on public.stock_requests to authenticated;
grant update (status, note, reviewed_at) on public.stock_requests to authenticated;
grant select, delete on public.gatepasses to authenticated;
grant insert (gatepass_number, requester_id, requester_name, item_name, quantity, unit, destination, purpose, status)
  on public.gatepasses to authenticated;
grant update (status, reviewed_at) on public.gatepasses to authenticated;

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Section leaders create their own stock requests"
  on public.stock_requests for insert to authenticated
  with check (
    public.current_app_role() = 'A'
    and requester_id = (select auth.uid())
    and status = 'pending'
  );

create policy "Section leaders and stock staff read requests"
  on public.stock_requests for select to authenticated
  using (
    (public.current_app_role() = 'A' and requester_id = (select auth.uid()))
    or public.current_app_role() = 'B'
  );

create policy "Stock staff review pending requests"
  on public.stock_requests for update to authenticated
  using (public.current_app_role() = 'B' and status = 'pending')
  with check (
    public.current_app_role() = 'B'
    and status in ('confirmed', 'unavailable')
  );

create policy "Section leaders cancel their own pending requests"
  on public.stock_requests for delete to authenticated
  using (
    public.current_app_role() = 'A'
    and requester_id = (select auth.uid())
    and status = 'pending'
  );

create policy "Section leaders create their own gatepasses"
  on public.gatepasses for insert to authenticated
  with check (
    public.current_app_role() = 'A'
    and requester_id = (select auth.uid())
    and status = 'pending'
  );

create policy "Section leaders and verifiers read gatepasses"
  on public.gatepasses for select to authenticated
  using (
    (public.current_app_role() = 'A' and requester_id = (select auth.uid()))
    or public.current_app_role() = 'C'
  );

create policy "Guards read verified gatepasses only"
  on public.gatepasses for select to authenticated
  using (
    public.current_app_role() = 'D'
    and status = 'verified'
  );

create policy "Verifiers review pending gatepasses"
  on public.gatepasses for update to authenticated
  using (public.current_app_role() = 'C' and status = 'pending')
  with check (
    public.current_app_role() = 'C'
    and status in ('verified', 'rejected')
  );

create policy "Section leaders cancel their own pending gatepasses"
  on public.gatepasses for delete to authenticated
  using (
    public.current_app_role() = 'A'
    and requester_id = (select auth.uid())
    and status = 'pending'
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'stock_requests'
    ) then
      alter publication supabase_realtime add table public.stock_requests;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'gatepasses'
    ) then
      alter publication supabase_realtime add table public.gatepasses;
    end if;
  end if;
end;
$$;
