-- Supabase project defaults had granted more than the initial explicit GRANTs.
-- GRANT is additive, so reset the inspected EXA table surface first.
revoke all on all tables in schema public from public, anon, authenticated;
grant select on public.authorized_devices, public.pairing_sessions,
  public.card_purchases, public.card_installments, public.invoices,
  public.invoice_payments, public.report_schedules, public.report_delivery_jobs to authenticated;
grant select, insert, update on public.profiles, public.financial_accounts,
  public.categories, public.transactions, public.credit_cards, public.calendar_events to authenticated;
-- Future tables must opt in explicitly; RLS is still required in each migration.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
