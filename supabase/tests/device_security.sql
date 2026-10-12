-- Runs against the deployed schema. All synthetic fixtures roll back.
begin;
do $$ begin
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and
      (not c.relrowsecurity or has_table_privilege('anon',c.oid,'SELECT')
        or has_table_privilege('authenticated',c.oid,'TRUNCATE'))) then
    raise exception 'TEST_FAILED: unsafe table privilege or missing RLS';
  end if;
end $$;
select set_config('exa.test.user_a',gen_random_uuid()::text,true);
select set_config('exa.test.user_b',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at) values
  (current_setting('exa.test.user_a')::uuid,'security-a@exa.invalid',now()),
  (current_setting('exa.test.user_b')::uuid,'security-b@exa.invalid',null);
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('exa.test.user_b'),'role','authenticated')::text,true);
do $$ begin
  begin
    perform public.bootstrap_first_device(repeat('b',64),'Test',repeat('b',64));
    raise exception 'TEST_FAILED: unconfirmed bootstrap allowed';
  exception when raise_exception then
    if sqlerrm <> 'EMAIL_NOT_CONFIRMED' then raise; end if;
  end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('exa.test.user_a'),'role','authenticated')::text,true);
do $$ declare v_device public.authorized_devices; v_account uuid; v_count integer;
  v_pair jsonb; v_link text; v_nonce text; v_new public.authorized_devices; i integer;
begin
  select * into v_device from public.bootstrap_first_device(repeat('a',64),'Security test',encode(extensions.digest(repeat('a',64),'sha256'),'hex'));
  perform set_config('request.headers',jsonb_build_object('x-exa-device-id',v_device.id,'x-exa-device-key',repeat('a',64))::text,true);
  if not public.has_active_device() then raise exception 'TEST_FAILED: valid device rejected'; end if;
  insert into public.financial_accounts(user_id,name) values(auth.uid(),'Rollback test') returning id into v_account;
  insert into public.transactions(user_id,account_id,kind,amount_cents,description,occurred_on,idempotency_key)
    values(auth.uid(),v_account,'income',10000,'Rollback salary',current_date,gen_random_uuid());
  select count(*) into v_count from public.financial_accounts where id=v_account;
  if v_count <> 1 then raise exception 'TEST_FAILED: read after write'; end if;
  begin
    insert into public.financial_accounts(user_id,name) values(current_setting('exa.test.user_b')::uuid,'Forbidden');
    raise exception 'TEST_FAILED: cross-user write allowed';
  exception when insufficient_privilege then null; end;
  perform set_config('request.headers','{"x-exa-device-id":"bad-id","x-exa-device-key":"bad-key"}',true);
  if public.has_active_device() then raise exception 'TEST_FAILED: bad credential accepted'; end if;
  select count(*) into v_count from public.financial_accounts where id=v_account;
  if v_count <> 0 then raise exception 'TEST_FAILED: data exposed without device'; end if;
  perform set_config('request.headers',jsonb_build_object('x-exa-device-id',v_device.id,'x-exa-device-key',repeat('a',64))::text,true);
  begin
    perform public.revoke_device(v_device.id);
    raise exception 'TEST_FAILED: last device removed';
  exception when raise_exception then if sqlerrm <> 'LAST_DEVICE_REQUIRED' then raise; end if; end;
  for i in 1..4 loop
    v_pair := public.create_device_pairing();
    v_nonce := split_part(v_pair->>'link','&nonce=',2);
    perform public.request_device_pairing((v_pair->>'id')::uuid,v_nonce,repeat(i::text,64),repeat(i::text,64),'Fixture '||i,case when i=1 then 'web' else 'android' end);
    begin
      perform public.request_device_pairing((v_pair->>'id')::uuid,v_nonce,repeat(i::text,64),repeat(i::text,64),'Replay','android');
      raise exception 'TEST_FAILED: nonce replay accepted';
    exception when raise_exception then if sqlerrm <> 'PAIRING_NOT_AVAILABLE' then raise; end if; end;
    select * into v_new from public.approve_pairing((v_pair->>'id')::uuid,v_device.id);
    if i=1 and v_new.kind<>'web' then raise exception 'TEST_FAILED: browser pairing'; end if;
  end loop;
  v_pair := public.create_device_pairing();
  perform public.request_device_pairing((v_pair->>'id')::uuid,split_part(v_pair->>'link','&nonce=',2),repeat('6',64),repeat('6',64),'Sixth','android');
  begin
    perform public.approve_pairing((v_pair->>'id')::uuid,v_device.id);
    raise exception 'TEST_FAILED: sixth device allowed';
  exception when raise_exception then if sqlerrm <> 'DEVICE_LIMIT_REACHED' then raise; end if; end;
  perform public.revoke_device(v_device.id);
  if public.has_active_device() then raise exception 'TEST_FAILED: revoked device accepted'; end if;
end $$;
reset role;
rollback;
select 'PASS: confirmation, bootstrap, financial writes/reads, ownership, invalid credentials, web/android pairing, replay rejection, 5-device limit, last-device guard, revocation; fixtures rolled back' as result;
