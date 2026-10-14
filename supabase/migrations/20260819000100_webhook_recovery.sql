create extension if not exists pgcrypto with schema extensions;

alter table public.stripe_events
  add column processing_token uuid,
  add column processing_started_at timestamptz,
  add column attempt_count integer not null default 0 check (attempt_count >= 0);

create index stripe_events_processing_lease_idx
  on public.stripe_events (processing_started_at, created_at)
  where outcome = 'processing';

create or replace function public.claim_stripe_event(
  p_id text,
  p_type text,
  p_event_created timestamptz,
  p_payload jsonb,
  p_token uuid,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  event_row public.stripe_events%rowtype;
begin
  if p_token is null or p_lease_seconds < 1 then
    raise exception 'invalid Stripe event claim';
  end if;
  if p_payload ->> 'id' is distinct from p_id then
    raise exception 'Stripe event payload id does not match claim id';
  end if;

  insert into public.stripe_events (
    id,
    type,
    event_created,
    payload,
    outcome,
    processing_token,
    processing_started_at,
    attempt_count
  ) values (
    p_id,
    p_type,
    p_event_created,
    p_payload,
    'processing',
    p_token,
    clock_timestamp(),
    1
  )
  on conflict (id) do nothing
  returning * into event_row;

  if event_row.id is not null then
    return jsonb_build_object(
      'status', 'claimed',
      'attempt_count', event_row.attempt_count,
      'payload', event_row.payload
    );
  end if;

  select * into event_row
  from public.stripe_events
  where id = p_id
  for update;

  if event_row.type is distinct from p_type or event_row.payload ->> 'id' is distinct from p_id then
    raise exception 'Stripe event identity conflicts with the existing ledger row';
  end if;

  if event_row.outcome = 'failed'
    or (
      event_row.outcome = 'processing'
      and coalesce(event_row.processing_started_at, event_row.created_at)
        <= clock_timestamp() - make_interval(secs => p_lease_seconds)
    ) then
    update public.stripe_events
    set outcome = 'processing',
        processed_at = null,
        processing_token = p_token,
        processing_started_at = clock_timestamp(),
        attempt_count = attempt_count + 1
    where id = p_id
    returning * into event_row;

    return jsonb_build_object(
      'status', 'claimed',
      'attempt_count', event_row.attempt_count,
      'payload', event_row.payload
    );
  end if;

  if event_row.outcome = 'processing' then
    return jsonb_build_object(
      'status', 'busy',
      'attempt_count', event_row.attempt_count,
      'payload', event_row.payload
    );
  end if;

  return jsonb_build_object(
    'status', 'terminal',
    'outcome', event_row.outcome,
    'attempt_count', event_row.attempt_count,
    'payload', event_row.payload
  );
end;
$$;

create or replace function public.finalize_stripe_event(
  p_id text,
  p_token uuid,
  p_outcome text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated_id text;
begin
  if p_token is null or p_outcome is null or btrim(p_outcome) = '' or p_outcome = 'processing' then
    raise exception 'invalid Stripe event finalization';
  end if;

  update public.stripe_events
  set outcome = p_outcome,
      processed_at = clock_timestamp()
  where id = p_id
    and outcome = 'processing'
    and processing_token = p_token
  returning id into updated_id;

  return updated_id is not null;
end;
$$;

create or replace function public.grant_play_entitlement_atomic(
  p_account_id uuid,
  p_sku text,
  p_license_key text,
  p_license_key_hash text,
  p_bundle_version text,
  p_bundle_sha256 text,
  p_version_ceiling timestamptz,
  p_grant text,
  p_org_name text,
  p_stripe_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  entitlement_row public.entitlements%rowtype;
  has_license boolean;
begin
  select * into entitlement_row
  from public.entitlements
  where account_id = p_account_id and sku = p_sku
  for update;

  if entitlement_row.id is not null then
    select exists (
      select 1 from public.licenses where entitlement_id = entitlement_row.id
    ) into has_license;

    if has_license then
      return jsonb_build_object(
        'outcome', 'existing',
        'entitlement_id', entitlement_row.id,
        'stripe_session_id', entitlement_row.stripe_session_id
      );
    end if;

    insert into public.licenses (entitlement_id, key_hash)
    values (
      entitlement_row.id,
      encode(extensions.digest(entitlement_row.license_key, 'sha256'), 'hex')
    );
    return jsonb_build_object('outcome', 'repaired-existing', 'entitlement_id', entitlement_row.id);
  end if;

  begin
    insert into public.entitlements (
      account_id,
      sku,
      license_key,
      bundle_version,
      bundle_sha256,
      version_ceiling,
      "grant",
      org_name,
      stripe_session_id
    ) values (
      p_account_id,
      p_sku,
      p_license_key,
      p_bundle_version,
      p_bundle_sha256,
      p_version_ceiling,
      p_grant,
      p_org_name,
      p_stripe_session_id
    )
    returning * into entitlement_row;

    insert into public.licenses (entitlement_id, key_hash)
    values (entitlement_row.id, p_license_key_hash);
  exception when unique_violation then
    select * into entitlement_row
    from public.entitlements
    where account_id = p_account_id and sku = p_sku
    for update;

    if entitlement_row.id is null then
      raise;
    end if;

    select exists (
      select 1 from public.licenses where entitlement_id = entitlement_row.id
    ) into has_license;

    if has_license then
      return jsonb_build_object(
        'outcome', 'existing',
        'entitlement_id', entitlement_row.id,
        'stripe_session_id', entitlement_row.stripe_session_id
      );
    end if;

    insert into public.licenses (entitlement_id, key_hash)
    values (
      entitlement_row.id,
      encode(extensions.digest(entitlement_row.license_key, 'sha256'), 'hex')
    );
    return jsonb_build_object('outcome', 'repaired-existing', 'entitlement_id', entitlement_row.id);
  end;

  return jsonb_build_object('outcome', 'created', 'entitlement_id', entitlement_row.id);
end;
$$;

revoke all on function public.claim_stripe_event(text, text, timestamptz, jsonb, uuid, integer) from public;
revoke all on function public.finalize_stripe_event(text, uuid, text) from public;
revoke all on function public.grant_play_entitlement_atomic(uuid, text, text, text, text, text, timestamptz, text, text, text) from public;

grant execute on function public.claim_stripe_event(text, text, timestamptz, jsonb, uuid, integer) to service_role;
grant execute on function public.finalize_stripe_event(text, uuid, text) to service_role;
grant execute on function public.grant_play_entitlement_atomic(uuid, text, text, text, text, text, timestamptz, text, text, text) to service_role;
