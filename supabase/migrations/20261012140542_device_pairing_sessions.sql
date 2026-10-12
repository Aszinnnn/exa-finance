-- Both platforms use the same guarded RPCs; no administrative key in clients.
alter table public.pairing_sessions add column requested_device_kind text not null default 'android'
  check (requested_device_kind in ('web','android'));

create function public.bootstrap_device(p_installation_hash text, p_name text, p_device_key_hash text, p_kind text)
returns public.authorized_devices language plpgsql security definer set search_path = '' as $$
declare v_device public.authorized_devices;
begin
  if p_kind is null or p_kind not in ('web','android') then raise exception 'VALIDATION_ERROR'; end if;
  v_device := public.bootstrap_first_device(p_installation_hash, p_name, p_device_key_hash);
  update public.authorized_devices set kind = p_kind where id = v_device.id returning * into v_device;
  return v_device;
end $$;
revoke all on function public.bootstrap_device(text,text,text,text) from public, anon;
grant execute on function public.bootstrap_device(text,text,text,text) to authenticated;

create function public.create_device_pairing() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_nonce text; v_source uuid; v_expiry timestamptz := now() + interval '5 minutes';
begin
  if not public.has_active_device() then raise exception 'DEVICE_NOT_AUTHORIZED'; end if;
  if not public.consume_api_limit(auth.uid(),'pairing_create',10,3600) then raise exception 'RATE_LIMITED'; end if;
  v_source := (current_setting('request.headers',true)::jsonb ->> 'x-exa-device-id')::uuid;
  v_nonce := encode(extensions.gen_random_bytes(32),'hex');
  insert into public.pairing_sessions(user_id,source_device_id,nonce_hash,expires_at)
    values(auth.uid(),v_source,encode(extensions.digest(v_nonce,'sha256'),'hex'),v_expiry) returning id into v_id;
  return jsonb_build_object('id',v_id,'expires_at',v_expiry,'link','exa://pair?session='||v_id||'&nonce='||v_nonce);
end $$;
revoke all on function public.create_device_pairing() from public, anon;
grant execute on function public.create_device_pairing() to authenticated;

create function public.request_device_pairing(p_session_id uuid, p_nonce text, p_installation_hash text,
  p_key_hash text, p_name text, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_verified_account() then raise exception 'EMAIL_NOT_CONFIRMED'; end if;
  if p_nonce is null or p_nonce !~ '^[0-9a-f]{64}$' or p_installation_hash is null
    or p_installation_hash !~ '^[0-9a-f]{64}$' or p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$'
    or p_name is null or char_length(trim(p_name)) not between 1 and 80
    or p_kind is null or p_kind not in ('web','android') then raise exception 'VALIDATION_ERROR'; end if;
  if not public.consume_api_limit(auth.uid(),'pairing_request',20,3600) then raise exception 'RATE_LIMITED'; end if;
  update public.pairing_sessions set status='requested', requested_device_hash=p_installation_hash,
    requested_device_key_hash=p_key_hash, requested_device_name=trim(p_name), requested_device_kind=p_kind
    where id=p_session_id and user_id=auth.uid() and status='created' and expires_at>now()
      and nonce_hash=encode(extensions.digest(p_nonce,'sha256'),'hex');
  if not found then raise exception 'PAIRING_NOT_AVAILABLE'; end if;
end $$;
revoke all on function public.request_device_pairing(uuid,text,text,text,text,text) from public, anon;
grant execute on function public.request_device_pairing(uuid,text,text,text,text,text) to authenticated;

create or replace function public.approve_pairing(p_session_id uuid, p_source_device_id uuid)
returns public.authorized_devices language plpgsql security definer set search_path = '' as $$
declare v_pair public.pairing_sessions; v_device public.authorized_devices; v_source uuid;
begin
  if not public.has_active_device() then raise exception 'DEVICE_NOT_AUTHORIZED'; end if;
  v_source := (current_setting('request.headers',true)::jsonb ->> 'x-exa-device-id')::uuid;
  if v_source is distinct from p_source_device_id then raise exception 'SOURCE_DEVICE_MISMATCH'; end if;
  perform 1 from auth.users where id=auth.uid() for update;
  select * into v_pair from public.pairing_sessions where id=p_session_id and user_id=auth.uid() for update;
  if not found or v_pair.status<>'requested' or v_pair.expires_at<=now() then raise exception 'PAIRING_NOT_AVAILABLE'; end if;
  if v_pair.source_device_id<>v_source then raise exception 'SOURCE_DEVICE_MISMATCH'; end if;
  if (select count(*) from public.authorized_devices where user_id=auth.uid() and revoked_at is null)>=5
    then raise exception 'DEVICE_LIMIT_REACHED'; end if;
  if v_pair.requested_device_hash is null or v_pair.requested_device_key_hash is null
    or v_pair.requested_device_name is null then raise exception 'PAIRING_INCOMPLETE'; end if;
  insert into public.authorized_devices(user_id,installation_id_hash,name,kind)
    values(auth.uid(),v_pair.requested_device_hash,v_pair.requested_device_name,v_pair.requested_device_kind)
    returning * into v_device;
  insert into public.device_credentials(device_id,key_hash) values(v_device.id,v_pair.requested_device_key_hash);
  update public.pairing_sessions set status='approved',approved_at=now() where id=p_session_id;
  return v_device;
end $$;

-- Serialize revocation with approvals. Never leave an account with no trusted device.
create or replace function public.revoke_device(p_device_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_active_device() then raise exception 'DEVICE_NOT_AUTHORIZED'; end if;
  perform 1 from auth.users where id=auth.uid() for update;
  if (select count(*) from public.authorized_devices where user_id=auth.uid() and revoked_at is null)<=1
    then raise exception 'LAST_DEVICE_REQUIRED'; end if;
  update public.authorized_devices set revoked_at=now()
    where id=p_device_id and user_id=auth.uid() and revoked_at is null;
  if not found then raise exception 'DEVICE_NOT_FOUND'; end if;
end $$;
