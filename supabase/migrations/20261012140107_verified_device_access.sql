-- Check authoritative Auth data, never user-editable user_metadata.
create or replace function public.has_verified_account() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.users u where u.id = auth.uid()
    and u.email_confirmed_at is not null and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now()));
$$;
revoke all on function public.has_verified_account() from public, anon;
grant execute on function public.has_verified_account() to authenticated;

create or replace function public.has_active_device() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_headers jsonb; v_device_id uuid; v_device_key text;
begin
  if not public.has_verified_account() then return false; end if;
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    v_device_id := (v_headers ->> 'x-exa-device-id')::uuid;
    v_device_key := v_headers ->> 'x-exa-device-key';
  exception when invalid_text_representation then return false;
  end;
  if v_device_id is null or v_device_key is null or v_device_key !~ '^[0-9a-f]{64}$' then return false; end if;
  return exists(select 1 from public.authorized_devices d
    join public.device_credentials c on c.device_id = d.id
    where d.id = v_device_id and d.user_id = auth.uid() and d.revoked_at is null
      and c.key_hash = encode(extensions.digest(v_device_key, 'sha256'), 'hex'));
end $$;
revoke all on function public.has_active_device() from public, anon;
grant execute on function public.has_active_device() to authenticated;

create or replace function public.bootstrap_first_device(p_installation_hash text, p_name text, p_device_key_hash text)
returns public.authorized_devices language plpgsql security definer set search_path = '' as $$
declare result public.authorized_devices;
begin
  if not public.has_verified_account() then raise exception 'EMAIL_NOT_CONFIRMED'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 80
    or p_installation_hash is null or p_installation_hash !~ '^[0-9a-f]{64}$'
    or p_device_key_hash is null or p_device_key_hash !~ '^[0-9a-f]{64}$' then raise exception 'VALIDATION_ERROR'; end if;
  perform 1 from auth.users where id = auth.uid() for update;
  select d.* into result from public.authorized_devices d
    join public.device_credentials c on c.device_id = d.id
    where d.user_id = auth.uid() and d.installation_id_hash = p_installation_hash
      and d.revoked_at is null and c.key_hash = p_device_key_hash;
  if found then return result; end if;
  if exists(select 1 from public.authorized_devices d where d.user_id = auth.uid()) then
    raise exception 'FIRST_DEVICE_ALREADY_REGISTERED';
  end if;
  insert into public.authorized_devices(user_id, installation_id_hash, name, kind)
    values (auth.uid(), p_installation_hash, trim(p_name), 'web') returning * into result;
  insert into public.device_credentials(device_id, key_hash) values (result.id, p_device_key_hash);
  return result;
end $$;
revoke all on function public.bootstrap_first_device(text,text,text) from public, anon;
grant execute on function public.bootstrap_first_device(text,text,text) to authenticated;

alter policy read_devices on public.authorized_devices using
  (user_id = (select auth.uid()) and (select public.has_verified_account()));
alter policy read_pairing on public.pairing_sessions using
  (user_id = (select auth.uid()) and (select public.has_verified_account()));

-- Strip accidental default grants; these tables are writable only by RPC/server.
revoke insert, update, delete, truncate, references, trigger on
  public.authorized_devices, public.pairing_sessions, public.card_purchases,
  public.card_installments, public.invoices, public.invoice_payments,
  public.report_schedules, public.report_delivery_jobs from anon, authenticated;
revoke all on public.device_credentials, public.api_rate_limits from anon, authenticated;
