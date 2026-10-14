create extension if not exists citext with schema extensions;

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade,
  email extensions.citext not null unique,
  waitlist_skus text[] not null default '{}',
  pending_device_code_hash text unique,
  pending_device_code_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  sku text not null,
  license_key text not null unique,
  bundle_version text not null default '1.0.0',
  bundle_sha256 text not null,
  version_ceiling timestamptz not null,
  "grant" text not null default 'single-org-perpetual',
  org_name text not null,
  status text not null default 'active' check (status in ('active', 'revoked', 'chargeback')),
  stripe_session_id text unique,
  created_at timestamptz not null default now(),
  unique (account_id, sku)
);

create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null unique references public.entitlements(id) on delete cascade,
  key_hash text not null unique,
  ordering_salt uuid not null default gen_random_uuid(),
  status text not null default 'active' check (status in ('active', 'revoked', 'chargeback')),
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.download_events (
  id bigint generated always as identity primary key,
  entitlement_id uuid not null references public.entitlements(id) on delete cascade,
  license_id uuid not null references public.licenses(id) on delete cascade,
  sku text not null,
  version text not null,
  ip_hash text,
  created_at timestamptz not null default now()
);

create table public.install_events (
  id bigint generated always as identity primary key,
  entitlement_id uuid not null references public.entitlements(id) on delete cascade,
  license_id uuid not null references public.licenses(id) on delete cascade,
  bundle_sha256 text not null,
  cli_version text,
  created_at timestamptz not null default now()
);

create table public.stripe_events (
  id text primary key,
  type text not null,
  event_created timestamptz not null,
  payload jsonb not null,
  processed_at timestamptz,
  outcome text,
  created_at timestamptz not null default now()
);

create index download_events_license_created_idx on public.download_events (license_id, created_at desc);
create index install_events_license_created_idx on public.install_events (license_id, created_at desc);

alter table public.accounts enable row level security;
alter table public.entitlements enable row level security;
alter table public.licenses enable row level security;
alter table public.download_events enable row level security;
alter table public.install_events enable row level security;
alter table public.stripe_events enable row level security;

create function public.owns_account(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.accounts
    where id = target and user_id = auth.uid()
  );
$$;

revoke all on function public.owns_account(uuid) from public;
grant execute on function public.owns_account(uuid) to authenticated;

create policy "account reads itself"
on public.accounts for select to authenticated
using (user_id = auth.uid());

create policy "account reads entitlements"
on public.entitlements for select to authenticated
using (public.owns_account(account_id));

create policy "account reads licenses"
on public.licenses for select to authenticated
using (
  exists (
    select 1 from public.entitlements
    where entitlements.id = licenses.entitlement_id
      and public.owns_account(entitlements.account_id)
  )
);

create policy "account reads download events"
on public.download_events for select to authenticated
using (
  exists (
    select 1 from public.entitlements
    where entitlements.id = download_events.entitlement_id
      and public.owns_account(entitlements.account_id)
  )
);

create policy "account reads install events"
on public.install_events for select to authenticated
using (
  exists (
    select 1 from public.entitlements
    where entitlements.id = install_events.entitlement_id
      and public.owns_account(entitlements.account_id)
  )
);

grant usage on schema public to authenticated, service_role;
grant select on public.accounts, public.entitlements, public.licenses, public.download_events, public.install_events to authenticated;
grant all on public.accounts, public.entitlements, public.licenses, public.download_events, public.install_events, public.stripe_events to service_role;
grant usage, select on all sequences in schema public to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('paid-bundles', 'paid-bundles', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
