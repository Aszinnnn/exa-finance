create extension if not exists pgcrypto;

-- Some Supabase projects install this event-trigger helper in public with the
-- default PUBLIC execute grant. It only needs to run as the event trigger.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now()
);

create function public.create_profile() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''));
  return new;
end $$;
create trigger create_profile_after_auth after insert on auth.users
for each row execute function public.create_profile();
revoke all on function public.create_profile() from public, anon, authenticated;

create table public.authorized_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id_hash text not null,
  name text not null check (char_length(name) between 1 and 80),
  kind text not null check (kind in ('web', 'android')),
  public_key text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, installation_id_hash)
);
create index authorized_devices_active_idx on public.authorized_devices(user_id) where revoked_at is null;

create table public.device_credentials (
  device_id uuid primary key references public.authorized_devices(id) on delete cascade,
  key_hash text not null check (char_length(key_hash) = 64)
);

create function public.has_active_device() returns boolean language plpgsql stable security definer set search_path = '' as $$
declare headers jsonb; device_id text; device_key text;
begin
  if auth.uid() is null then return false; end if;
  begin
    headers := current_setting('request.headers', true)::jsonb;
    device_id := headers ->> 'x-exa-device-id';
    device_key := headers ->> 'x-exa-device-key';
  exception when others then return false;
  end;
  if device_id is null or device_key is null or device_id !~ '^[0-9a-f-]{36}$' or device_key !~ '^[0-9a-f]{64}$' then return false; end if;
  return exists(
    select 1 from public.authorized_devices d
    join public.device_credentials c on c.device_id = d.id
    where d.id = device_id::uuid and d.user_id = auth.uid() and d.revoked_at is null
      and c.key_hash = encode(extensions.digest(device_key, 'sha256'), 'hex')
  );
end $$;
revoke all on function public.has_active_device() from public;
grant execute on function public.has_active_device() to authenticated;

create table public.pairing_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_device_id uuid not null references public.authorized_devices(id),
  nonce_hash text not null unique,
  requested_device_hash text,
  requested_device_key_hash text,
  requested_device_name text,
  requested_public_key text,
  status text not null default 'created' check (status in ('created','requested','approved','rejected','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  opening_balance_cents bigint,
  opening_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  check ((opening_balance_cents is null) = (opening_date is null)),
  unique (user_id, id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  kind text not null check (kind in ('income','expense')),
  unique (user_id, name, kind),
  unique (user_id, id)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  category_id uuid,
  kind text not null check (kind in ('income','expense','transfer','refund','adjustment','invoice_payment')),
  amount_cents bigint not null check (amount_cents > 0),
  description text not null check (char_length(description) between 1 and 160),
  occurred_on date not null,
  status text not null default 'settled' check (status in ('pending','settled')),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  foreign key (user_id, account_id) references public.financial_accounts(user_id, id),
  foreign key (user_id, category_id) references public.categories(user_id, id),
  unique (user_id, idempotency_key)
);
create index transactions_period_idx on public.transactions(user_id, occurred_on desc) where deleted_at is null;

create table public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  closing_day integer not null check (closing_day between 1 and 31),
  due_day integer not null check (due_day between 1 and 31),
  limit_cents bigint check (limit_cents > 0),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(user_id,id)
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null,
  period date not null check (extract(day from period) = 1),
  due_on date not null,
  created_at timestamptz not null default now(),
  foreign key (user_id,card_id) references public.credit_cards(user_id,id),
  unique(card_id,period),
  unique(user_id,id)
);

create table public.card_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null,
  description text not null check (char_length(description) between 1 and 160),
  purchased_on date not null,
  total_cents bigint not null check(total_cents > 0),
  installment_count integer not null check(installment_count between 1 and 120),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  foreign key (user_id,card_id) references public.credit_cards(user_id,id),
  unique(user_id,idempotency_key),
  unique(user_id,id)
);

create table public.card_installments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purchase_id uuid not null,
  invoice_id uuid not null,
  number integer not null check(number > 0),
  competence_month date not null check(extract(day from competence_month) = 1),
  amount_cents bigint not null check(amount_cents >= 0),
  foreign key (user_id,purchase_id) references public.card_purchases(user_id,id),
  foreign key (user_id,invoice_id) references public.invoices(user_id,id),
  unique(purchase_id,number)
);
create index installments_competence_idx on public.card_installments(user_id,competence_month);

create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid not null,
  cash_transaction_id uuid not null unique,
  amount_cents bigint not null check(amount_cents > 0),
  paid_on date not null,
  foreign key (user_id,invoice_id) references public.invoices(user_id,id),
  foreign key (cash_transaction_id) references public.transactions(id)
);

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'America/Sao_Paulo',
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ends_at > starts_at)
);
create index calendar_events_start_idx on public.calendar_events(user_id, starts_at) where deleted_at is null;

create table public.report_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  interval_days integer not null default 30 check (interval_days = 30),
  timezone text not null default 'America/Sao_Paulo',
  next_delivery_at timestamptz,
  recipient_e164 text,
  recipient_opted_in_at timestamptz,
  delivery_mode text not null default 'manual' check (delivery_mode in ('manual','cloud_api')),
  zero_cost_only boolean not null default true,
  last_scheduled_delivery_at timestamptz,
  last_successful_delivery_at timestamptz,
  updated_at timestamptz not null default now(),
  check (recipient_e164 is null or recipient_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  check (not enabled or next_delivery_at is not null)
);

create table public.report_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  schedule_id uuid references public.report_schedules(id) on delete set null,
  cycle_at timestamptz,
  requested_at timestamptz not null default now(),
  period_from date not null,
  period_to date not null,
  channel text not null default 'whatsapp' check (channel = 'whatsapp'),
  origin text not null check (origin in ('scheduled','on_demand')),
  idempotency_key uuid,
  status text not null default 'scheduled' check (status in ('scheduled','generating','ready_for_share','sending','provider_accepted','delivered','failed','blocked_by_zero_cost_policy','awaiting_manual_share')),
  provider_message_id text,
  attempts integer not null default 0,
  last_error_code text,
  delivered_at timestamptz,
  check (period_to >= period_from),
  check ((origin = 'scheduled' and cycle_at is not null) or (origin = 'on_demand' and idempotency_key is not null)),
  unique (user_id, idempotency_key)
);
create unique index report_jobs_cycle_unique on public.report_delivery_jobs(user_id, cycle_at, channel) where origin = 'scheduled';

create table public.api_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('report_generate','report_share','pairing_create','pairing_request','pairing_approve')),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0,
  primary key(user_id, action)
);

create function public.consume_api_limit(p_user_id uuid, p_action text, p_max integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare current_count integer;
begin
  if p_user_id is null or p_action not in ('report_generate','report_share','pairing_create','pairing_request','pairing_approve')
     or p_max not between 1 and 100 or p_window_seconds not between 60 and 86400 then raise exception 'VALIDATION_ERROR'; end if;
  insert into public.api_rate_limits(user_id,action,window_started_at,request_count)
    values(p_user_id,p_action,now(),1)
    on conflict(user_id,action) do update set
      window_started_at = case when public.api_rate_limits.window_started_at <= now() - (p_window_seconds || ' seconds')::interval
        then now() else public.api_rate_limits.window_started_at end,
      request_count = case when public.api_rate_limits.window_started_at <= now() - (p_window_seconds || ' seconds')::interval
        then 1 else public.api_rate_limits.request_count + 1 end
    returning request_count into current_count;
  return current_count <= p_max;
end $$;
revoke all on function public.consume_api_limit(uuid,text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_api_limit(uuid,text,integer,integer) to service_role;

create function public.touch_version() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end $$;
create trigger touch_accounts before update on public.financial_accounts for each row execute function public.touch_version();
create trigger touch_transactions before update on public.transactions for each row execute function public.touch_version();
create trigger touch_events before update on public.calendar_events for each row execute function public.touch_version();

create function public.bootstrap_first_device(p_installation_hash text, p_name text, p_device_key_hash text)
returns public.authorized_devices language plpgsql security definer set search_path = '' as $$
declare result public.authorized_devices;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if char_length(p_name) not between 1 and 80 or char_length(p_installation_hash) != 64 or p_device_key_hash !~ '^[0-9a-f]{64}$' then raise exception 'VALIDATION_ERROR'; end if;
  perform 1 from auth.users where id = auth.uid() for update;
  select * into result from public.authorized_devices
    where user_id = auth.uid() and installation_id_hash = p_installation_hash and revoked_at is null;
  if found then return result; end if;
  if exists(select 1 from public.authorized_devices where user_id = auth.uid()) then
    raise exception 'FIRST_DEVICE_ALREADY_REGISTERED';
  end if;
  insert into public.authorized_devices(user_id, installation_id_hash, name, kind, public_key)
    values (auth.uid(), p_installation_hash, p_name, 'web', null) returning * into result;
  insert into public.device_credentials(device_id, key_hash) values (result.id, p_device_key_hash);
  return result;
end $$;
revoke all on function public.bootstrap_first_device(text,text,text) from public;
grant execute on function public.bootstrap_first_device(text,text,text) to authenticated;

create function public.approve_pairing(p_session_id uuid, p_source_device_id uuid)
returns public.authorized_devices language plpgsql security definer set search_path = '' as $$
declare pairing public.pairing_sessions; result public.authorized_devices;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if not public.has_active_device() then raise exception 'DEVICE_NOT_AUTHORIZED'; end if;
  perform 1 from auth.users where id = auth.uid() for update;
  select * into pairing from public.pairing_sessions where id = p_session_id and user_id = auth.uid() for update;
  if not found or pairing.status != 'requested' or pairing.expires_at <= now() then raise exception 'PAIRING_NOT_AVAILABLE'; end if;
  if pairing.source_device_id != p_source_device_id then raise exception 'SOURCE_DEVICE_MISMATCH'; end if;
  if not exists(select 1 from public.authorized_devices where id = p_source_device_id and user_id = auth.uid() and revoked_at is null and kind = 'web') then raise exception 'SOURCE_DEVICE_REVOKED'; end if;
  if (select count(*) from public.authorized_devices where user_id = auth.uid() and revoked_at is null) >= 5 then raise exception 'DEVICE_LIMIT_REACHED'; end if;
  if pairing.requested_device_hash is null or pairing.requested_device_key_hash is null or pairing.requested_device_name is null then raise exception 'PAIRING_INCOMPLETE'; end if;
  insert into public.authorized_devices(user_id, installation_id_hash, name, kind, public_key)
    values (auth.uid(), pairing.requested_device_hash, pairing.requested_device_name, 'android', pairing.requested_public_key)
    returning * into result;
  insert into public.device_credentials(device_id, key_hash) values (result.id, pairing.requested_device_key_hash);
  update public.pairing_sessions set status = 'approved', approved_at = now() where id = p_session_id;
  return result;
end $$;
revoke all on function public.approve_pairing(uuid,uuid) from public;
grant execute on function public.approve_pairing(uuid,uuid) to authenticated;

create function public.revoke_device(p_device_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if not public.has_active_device() then raise exception 'DEVICE_NOT_AUTHORIZED'; end if;
  update public.authorized_devices set revoked_at = now()
    where id = p_device_id and user_id = auth.uid() and revoked_at is null;
  if not found then raise exception 'DEVICE_NOT_FOUND'; end if;
end $$;
revoke all on function public.revoke_device(uuid) from public;
grant execute on function public.revoke_device(uuid) to authenticated;

create function public.clamped_day(p_month date, p_day integer) returns date
language sql immutable set search_path = '' as $$
  select (date_trunc('month', p_month)::date +
    (least(p_day, extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::integer) - 1))::date
$$;

create function public.create_card_purchase(
  p_card_id uuid, p_description text, p_purchased_on date, p_total_cents bigint,
  p_installment_count integer, p_idempotency_key uuid
) returns public.card_purchases language plpgsql security definer set search_path = '' as $$
declare card public.credit_cards; result public.card_purchases; first_month date; period_month date; due_month date;
        invoice_id uuid; part bigint; i integer;
begin
  if auth.uid() is null or not public.has_active_device() then raise exception 'DEVICE_NOT_AUTHORIZED'; end if;
  if p_idempotency_key is null or p_total_cents <= 0 or p_installment_count not between 1 and 120
     or p_total_cents < p_installment_count or char_length(trim(p_description)) not between 1 and 160 then raise exception 'VALIDATION_ERROR'; end if;
  perform 1 from auth.users where id = auth.uid() for update;
  select * into result from public.card_purchases where user_id = auth.uid() and idempotency_key = p_idempotency_key;
  if found then return result; end if;
  select * into card from public.credit_cards where id = p_card_id and user_id = auth.uid() and deleted_at is null for update;
  if not found then raise exception 'CARD_NOT_FOUND'; end if;
  first_month := date_trunc('month', p_purchased_on)::date;
  if p_purchased_on > public.clamped_day(first_month, card.closing_day) then first_month := (first_month + interval '1 month')::date; end if;
  insert into public.card_purchases(user_id,card_id,description,purchased_on,total_cents,installment_count,idempotency_key)
    values(auth.uid(),p_card_id,trim(p_description),p_purchased_on,p_total_cents,p_installment_count,p_idempotency_key) returning * into result;
  for i in 1..p_installment_count loop
    period_month := (first_month + ((i - 1) || ' months')::interval)::date;
    due_month := case when card.due_day <= card.closing_day then (period_month + interval '1 month')::date else period_month end;
    insert into public.invoices(user_id,card_id,period,due_on)
      values(auth.uid(),p_card_id,period_month,public.clamped_day(due_month,card.due_day)) on conflict(card_id,period) do nothing;
    select id into invoice_id from public.invoices where card_id = p_card_id and period = period_month;
    part := case when i = p_installment_count then p_total_cents - (p_total_cents / p_installment_count) * (p_installment_count - 1)
                 else p_total_cents / p_installment_count end;
    insert into public.card_installments(user_id,purchase_id,invoice_id,number,competence_month,amount_cents)
      values(auth.uid(),result.id,invoice_id,i,period_month,part);
  end loop;
  return result;
end $$;
revoke all on function public.create_card_purchase(uuid,text,date,bigint,integer,uuid) from public;
grant execute on function public.create_card_purchase(uuid,text,date,bigint,integer,uuid) to authenticated;

create function public.pay_invoice(p_invoice_id uuid, p_account_id uuid, p_amount_cents bigint, p_paid_on date, p_idempotency_key uuid)
returns public.invoice_payments language plpgsql security definer set search_path = '' as $$
declare invoice public.invoices; existing public.transactions; result public.invoice_payments;
        total bigint; paid bigint; cash_id uuid;
begin
  if auth.uid() is null or not public.has_active_device() then raise exception 'DEVICE_NOT_AUTHORIZED'; end if;
  if p_idempotency_key is null or p_amount_cents <= 0 then raise exception 'VALIDATION_ERROR'; end if;
  perform 1 from auth.users where id = auth.uid() for update;
  select * into existing from public.transactions where user_id = auth.uid() and idempotency_key = p_idempotency_key;
  if found then
    select * into result from public.invoice_payments where cash_transaction_id = existing.id and invoice_id = p_invoice_id;
    if found then return result; end if;
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;
  select * into invoice from public.invoices where id = p_invoice_id and user_id = auth.uid() for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if not exists(select 1 from public.financial_accounts where id = p_account_id and user_id = auth.uid() and deleted_at is null) then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  select coalesce(sum(amount_cents),0) into total from public.card_installments where invoice_id = p_invoice_id;
  select coalesce(sum(amount_cents),0) into paid from public.invoice_payments where invoice_id = p_invoice_id;
  if p_amount_cents > total - paid then raise exception 'PAYMENT_EXCEEDS_BALANCE'; end if;
  insert into public.transactions(user_id,account_id,kind,amount_cents,description,occurred_on,status,idempotency_key)
    values(auth.uid(),p_account_id,'invoice_payment',p_amount_cents,'Pagamento de fatura',p_paid_on,'settled',p_idempotency_key)
    returning id into cash_id;
  insert into public.invoice_payments(user_id,invoice_id,cash_transaction_id,amount_cents,paid_on)
    values(auth.uid(),p_invoice_id,cash_id,p_amount_cents,p_paid_on) returning * into result;
  return result;
end $$;
revoke all on function public.pay_invoice(uuid,uuid,bigint,date,uuid) from public;
grant execute on function public.pay_invoice(uuid,uuid,bigint,date,uuid) to authenticated;

create function public.configure_report_schedule(
  p_enabled boolean, p_mode text, p_recipient text, p_consent boolean, p_zero_cost_only boolean
) returns public.report_schedules language plpgsql security definer set search_path = '' as $$
declare result public.report_schedules;
begin
  if auth.uid() is null or not public.has_active_device() then raise exception 'DEVICE_NOT_AUTHORIZED'; end if;
  if p_mode not in ('manual','cloud_api') then raise exception 'VALIDATION_ERROR'; end if;
  if p_mode = 'cloud_api' and (p_recipient is null or p_recipient !~ '^\+[1-9][0-9]{7,14}$' or not p_consent) then raise exception 'RECIPIENT_NOT_CONSENTED'; end if;
  perform 1 from auth.users where id = auth.uid() for update;
  insert into public.report_schedules(user_id,enabled,delivery_mode,recipient_e164,recipient_opted_in_at,zero_cost_only,next_delivery_at)
    values(auth.uid(),p_enabled,p_mode,nullif(p_recipient,''),
      case when p_mode = 'cloud_api' and p_consent then now() else null end,
      p_zero_cost_only,case when p_enabled then now() + interval '30 days' else null end)
    on conflict(user_id) do update set
      enabled = excluded.enabled,
      delivery_mode = excluded.delivery_mode,
      recipient_e164 = excluded.recipient_e164,
      recipient_opted_in_at = case when excluded.delivery_mode = 'cloud_api' and p_consent then
        case when public.report_schedules.recipient_e164 = excluded.recipient_e164 then coalesce(public.report_schedules.recipient_opted_in_at,now()) else now() end
        else null end,
      zero_cost_only = excluded.zero_cost_only,
      next_delivery_at = case when excluded.enabled and not public.report_schedules.enabled then now() + interval '30 days'
        else public.report_schedules.next_delivery_at end,
      updated_at = now()
    returning * into result;
  return result;
end $$;
revoke all on function public.configure_report_schedule(boolean,text,text,boolean,boolean) from public;
grant execute on function public.configure_report_schedule(boolean,text,text,boolean,boolean) to authenticated;

create function public.dashboard_finance_summary() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare month_start date; month_end date; income bigint; expense bigint; cash_delta bigint;
        opening_total bigint; account_count integer; configured_count integer; by_account jsonb;
begin
  if auth.uid() is null or not public.has_active_device() then raise exception 'DEVICE_NOT_AUTHORIZED'; end if;
  month_start := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
  month_end := (month_start + interval '1 month')::date;
  select count(*), count(opening_balance_cents), coalesce(sum(opening_balance_cents),0)
    into account_count, configured_count, opening_total
    from public.financial_accounts where user_id = auth.uid() and deleted_at is null;
  select
    coalesce(sum(amount_cents) filter(where kind = 'income' and occurred_on >= month_start and occurred_on < month_end),0),
    coalesce(sum(amount_cents) filter(where kind = 'expense' and occurred_on >= month_start and occurred_on < month_end),0),
    coalesce(sum(case when status = 'settled' and kind in ('income','refund') then amount_cents
      when status = 'settled' and kind in ('expense','invoice_payment') then -amount_cents else 0 end),0)
    into income, expense, cash_delta
    from public.transactions where user_id = auth.uid() and deleted_at is null;
  select coalesce(jsonb_object_agg(account_id::text, balance_cents), '{}'::jsonb) into by_account from (
    select a.id as account_id, a.opening_balance_cents + coalesce(sum(
      case when t.status = 'settled' and t.kind in ('income','refund') then t.amount_cents
        when t.status = 'settled' and t.kind in ('expense','invoice_payment') then -t.amount_cents else 0 end),0) as balance_cents
    from public.financial_accounts a left join public.transactions t on t.account_id = a.id and t.user_id = a.user_id and t.deleted_at is null
    where a.user_id = auth.uid() and a.deleted_at is null group by a.id
  ) balances;
  return jsonb_build_object('income_cents',income,'expense_cents',expense,'balance_cents',opening_total + cash_delta,
    'balance_known', account_count > 0 and account_count = configured_count,'account_balances',by_account);
end $$;
revoke all on function public.dashboard_finance_summary() from public;
grant execute on function public.dashboard_finance_summary() to authenticated;

create function public.claim_due_report_jobs(p_limit integer default 20)
returns setof public.report_delivery_jobs language plpgsql security definer set search_path = '' as $$
declare schedule_row public.report_schedules; job_row public.report_delivery_jobs;
begin
  if current_user not in ('postgres', 'service_role') then raise exception 'FORBIDDEN'; end if;
  for schedule_row in
    select * from public.report_schedules
    where enabled and next_delivery_at <= now()
    order by next_delivery_at
    limit least(greatest(p_limit, 1), 100)
    for update skip locked
  loop
    insert into public.report_delivery_jobs(user_id, schedule_id, cycle_at, period_from, period_to, origin)
      values (schedule_row.user_id, schedule_row.id, schedule_row.next_delivery_at,
        (schedule_row.next_delivery_at at time zone schedule_row.timezone)::date - 30,
        (schedule_row.next_delivery_at at time zone schedule_row.timezone)::date - 1,
        'scheduled')
      on conflict do nothing returning * into job_row;
    update public.report_schedules set
      last_scheduled_delivery_at = next_delivery_at,
      next_delivery_at = next_delivery_at + interval '30 days',
      updated_at = now()
      where id = schedule_row.id;
    if job_row.id is not null then return next job_row; end if;
    job_row := null;
  end loop;
end $$;
revoke all on function public.claim_due_report_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_due_report_jobs(integer) to service_role;

alter table public.profiles enable row level security;
alter table public.authorized_devices enable row level security;
alter table public.device_credentials enable row level security;
alter table public.pairing_sessions enable row level security;
alter table public.financial_accounts enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.credit_cards enable row level security;
alter table public.card_purchases enable row level security;
alter table public.card_installments enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_payments enable row level security;
alter table public.calendar_events enable row level security;
alter table public.report_schedules enable row level security;
alter table public.report_delivery_jobs enable row level security;
alter table public.api_rate_limits enable row level security;

create policy own_profiles on public.profiles for all to authenticated using (id = auth.uid() and public.has_active_device()) with check (id = auth.uid() and public.has_active_device());
create policy read_devices on public.authorized_devices for select to authenticated using (user_id = auth.uid());
create policy read_pairing on public.pairing_sessions for select to authenticated using (user_id = auth.uid());
create policy own_accounts on public.financial_accounts for all to authenticated using (user_id = auth.uid() and public.has_active_device()) with check (user_id = auth.uid() and public.has_active_device());
create policy own_categories on public.categories for all to authenticated using (user_id = auth.uid() and public.has_active_device()) with check (user_id = auth.uid() and public.has_active_device());
create policy read_transactions on public.transactions for select to authenticated using (user_id = auth.uid() and public.has_active_device());
create policy insert_transactions on public.transactions for insert to authenticated with check (user_id = auth.uid() and public.has_active_device() and kind != 'invoice_payment');
create policy update_transactions on public.transactions for update to authenticated using (user_id = auth.uid() and public.has_active_device() and kind != 'invoice_payment') with check (user_id = auth.uid() and public.has_active_device() and kind != 'invoice_payment');
create policy own_cards on public.credit_cards for all to authenticated using (user_id = auth.uid() and public.has_active_device()) with check (user_id = auth.uid() and public.has_active_device());
create policy read_purchases on public.card_purchases for select to authenticated using (user_id = auth.uid() and public.has_active_device());
create policy read_installments on public.card_installments for select to authenticated using (user_id = auth.uid() and public.has_active_device());
create policy read_invoices on public.invoices for select to authenticated using (user_id = auth.uid() and public.has_active_device());
create policy read_invoice_payments on public.invoice_payments for select to authenticated using (user_id = auth.uid() and public.has_active_device());
create policy own_events on public.calendar_events for all to authenticated using (user_id = auth.uid() and public.has_active_device()) with check (user_id = auth.uid() and public.has_active_device());
create policy read_report_schedules on public.report_schedules for select to authenticated using (user_id = auth.uid() and public.has_active_device());
create policy read_report_jobs on public.report_delivery_jobs for select to authenticated using (user_id = auth.uid() and public.has_active_device());

-- Explicit API grants: RLS supplies row-level authorization, while these
-- grants limit the Data API surface to the operations used by the clients.
grant usage on schema public to authenticated;
grant select on public.authorized_devices, public.pairing_sessions,
  public.card_purchases, public.card_installments, public.invoices,
  public.invoice_payments, public.report_schedules, public.report_delivery_jobs
  to authenticated;
grant select, insert, update on public.profiles, public.financial_accounts,
  public.categories, public.transactions, public.credit_cards,
  public.calendar_events to authenticated;
revoke all on public.device_credentials, public.api_rate_limits from anon, authenticated;

alter publication supabase_realtime add table
  public.financial_accounts,
  public.transactions,
  public.calendar_events,
  public.credit_cards,
  public.card_purchases,
  public.card_installments,
  public.invoices,
  public.invoice_payments,
  public.report_schedules,
  public.report_delivery_jobs;
