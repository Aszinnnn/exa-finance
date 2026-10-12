-- The existing project grants EXECUTE to anon through its default privileges.
-- These RPCs are intended for signed-in users only, and validate auth.uid().
revoke all on function public.has_active_device() from anon;
revoke all on function public.bootstrap_first_device(text,text,text) from anon;
revoke all on function public.approve_pairing(uuid,uuid) from anon;
revoke all on function public.revoke_device(uuid) from anon;
revoke all on function public.create_card_purchase(uuid,text,date,bigint,integer,uuid) from anon;
revoke all on function public.pay_invoice(uuid,uuid,bigint,date,uuid) from anon;
revoke all on function public.configure_report_schedule(boolean,text,text,boolean,boolean) from anon;
revoke all on function public.dashboard_finance_summary() from anon;

-- RLS policies cache stable request identity and device validation once per
-- statement instead of recalculating them for every row.
drop policy own_profiles on public.profiles;
create policy own_profiles on public.profiles for all to authenticated
  using (id = (select auth.uid()) and (select public.has_active_device()))
  with check (id = (select auth.uid()) and (select public.has_active_device()));

drop policy read_devices on public.authorized_devices;
create policy read_devices on public.authorized_devices for select to authenticated
  using (user_id = (select auth.uid()));

drop policy read_pairing on public.pairing_sessions;
create policy read_pairing on public.pairing_sessions for select to authenticated
  using (user_id = (select auth.uid()));

drop policy own_accounts on public.financial_accounts;
create policy own_accounts on public.financial_accounts for all to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_device()))
  with check (user_id = (select auth.uid()) and (select public.has_active_device()));

drop policy own_categories on public.categories;
create policy own_categories on public.categories for all to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_device()))
  with check (user_id = (select auth.uid()) and (select public.has_active_device()));

drop policy read_transactions on public.transactions;
create policy read_transactions on public.transactions for select to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_device()));
drop policy insert_transactions on public.transactions;
create policy insert_transactions on public.transactions for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.has_active_device()) and kind != 'invoice_payment');
drop policy update_transactions on public.transactions;
create policy update_transactions on public.transactions for update to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_device()) and kind != 'invoice_payment')
  with check (user_id = (select auth.uid()) and (select public.has_active_device()) and kind != 'invoice_payment');

drop policy own_cards on public.credit_cards;
create policy own_cards on public.credit_cards for all to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_device()))
  with check (user_id = (select auth.uid()) and (select public.has_active_device()));

drop policy read_purchases on public.card_purchases;
create policy read_purchases on public.card_purchases for select to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_device()));
drop policy read_installments on public.card_installments;
create policy read_installments on public.card_installments for select to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_device()));
drop policy read_invoices on public.invoices;
create policy read_invoices on public.invoices for select to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_device()));
drop policy read_invoice_payments on public.invoice_payments;
create policy read_invoice_payments on public.invoice_payments for select to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_device()));

drop policy own_events on public.calendar_events;
create policy own_events on public.calendar_events for all to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_device()))
  with check (user_id = (select auth.uid()) and (select public.has_active_device()));
drop policy read_report_schedules on public.report_schedules;
create policy read_report_schedules on public.report_schedules for select to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_device()));
drop policy read_report_jobs on public.report_delivery_jobs;
create policy read_report_jobs on public.report_delivery_jobs for select to authenticated
  using (user_id = (select auth.uid()) and (select public.has_active_device()));

-- Cover the ownership and relationship foreign keys for cascades and joins.
create index transactions_account_owner_idx on public.transactions(user_id, account_id);
create index transactions_category_owner_idx on public.transactions(user_id, category_id) where category_id is not null;
create index pairing_sessions_owner_idx on public.pairing_sessions(user_id);
create index pairing_sessions_source_device_idx on public.pairing_sessions(source_device_id);
create index invoices_card_owner_idx on public.invoices(user_id, card_id);
create index card_purchases_card_owner_idx on public.card_purchases(user_id, card_id);
create index card_installments_invoice_owner_idx on public.card_installments(user_id, invoice_id);
create index card_installments_purchase_owner_idx on public.card_installments(user_id, purchase_id);
create index invoice_payments_owner_idx on public.invoice_payments(user_id);
create index invoice_payments_invoice_owner_idx on public.invoice_payments(user_id, invoice_id);
create index report_delivery_jobs_schedule_idx on public.report_delivery_jobs(schedule_id) where schedule_id is not null;
