alter table public.entitlements
  alter column bundle_version set default '2.0.0',
  alter column "grant" set default 'single-org-source-visible';

insert into storage.buckets (id, name, public, file_size_limit)
values ('paid-bundles', 'paid-bundles', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
