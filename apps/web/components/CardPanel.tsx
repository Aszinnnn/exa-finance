'use client';

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatBrl, parseBrlCents } from '@exa/domain';

type Card = { id: string; name: string; closing_day: number; due_day: number };
type Invoice = { id: string; card_id: string; period: string; due_on: string };
type Installment = { invoice_id: string; amount_cents: number };
type Payment = { invoice_id: string; amount_cents: number };
type Account = { id: string; name: string };

export function CardPanel({ db, userId, accounts }: { db: SupabaseClient; userId: string; accounts: Account[] }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [message, setMessage] = useState('');
  const [cardName, setCardName] = useState('');
  const [closing, setClosing] = useState('20');
  const [due, setDue] = useState('10');
  const [purchaseCard, setPurchaseCard] = useState('');
  const [purchaseDescription, setPurchaseDescription] = useState('');
  const [purchaseAmount, setPurchaseAmount] = useState('');
  const [count, setCount] = useState('1');
  const [paymentAccount, setPaymentAccount] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentInvoice, setPaymentInvoice] = useState('');

  async function reload() {
    const [c, i, p, t] = await Promise.all([
      db.from('credit_cards').select('id,name,closing_day,due_day').is('deleted_at', null).order('created_at'),
      db.from('invoices').select('id,card_id,period,due_on').order('period', { ascending: false }).limit(30),
      db.from('card_installments').select('invoice_id,amount_cents'),
      db.from('invoice_payments').select('invoice_id,amount_cents')
    ]);
    const error = c.error ?? i.error ?? p.error ?? t.error;
    if (error) { setMessage(error.message); return; }
    setCards((c.data ?? []) as Card[]); setInvoices((i.data ?? []) as Invoice[]);
    setInstallments((p.data ?? []) as Installment[]); setPayments((t.data ?? []) as Payment[]);
  }
  useEffect(() => {
    void reload();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reconcile = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void reload(); }, 180);
    };
    const channel = db.channel(`exa-cards-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'credit_cards' }, reconcile)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'card_purchases' }, reconcile)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'card_installments' }, reconcile)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, reconcile)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoice_payments' }, reconcile)
      .subscribe(status => { if (status === 'SUBSCRIBED') reconcile(); });
    const onFocus = () => reconcile();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      void db.removeChannel(channel);
    };
  }, [db, userId]);

  async function addCard() {
    const { error } = await db.from('credit_cards').insert({ user_id: userId, name: cardName.trim(), closing_day: Number(closing), due_day: Number(due) });
    setMessage(error?.message ?? 'Cartão cadastrado.');
    if (!error) { setCardName(''); await reload(); }
  }
  async function addPurchase() {
    try {
      const { error } = await db.rpc('create_card_purchase', { p_card_id: purchaseCard, p_description: purchaseDescription.trim(), p_purchased_on: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }), p_total_cents: parseBrlCents(purchaseAmount), p_installment_count: Number(count), p_idempotency_key: crypto.randomUUID() });
      if (error) throw error;
      setMessage('Compra parcelada registrada.'); setPurchaseDescription(''); setPurchaseAmount(''); await reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha ao registrar compra.'); }
  }
  async function payInvoice() {
    try {
      const { error } = await db.rpc('pay_invoice', { p_invoice_id: paymentInvoice, p_account_id: paymentAccount, p_amount_cents: parseBrlCents(paymentAmount), p_paid_on: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }), p_idempotency_key: crypto.randomUUID() });
      if (error) throw error;
      setMessage('Pagamento registrado como saída de caixa.'); setPaymentAmount(''); await reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha ao pagar fatura.'); }
  }

  const open = invoices.map(invoice => ({ ...invoice,
    total: installments.filter(p => p.invoice_id === invoice.id).reduce((n,p) => n + p.amount_cents, 0),
    paid: payments.filter(p => p.invoice_id === invoice.id).reduce((n,p) => n + p.amount_cents, 0)
  })).filter(invoice => invoice.total > invoice.paid);

  return <section className="panel cardPanel"><div className="panelTitle"><div><h2>Cartões e faturas</h2><p>Compras por competência; pagamentos como saída de caixa.</p></div></div>
    {message && <p className="hint" role="status">{message}</p>}
    <div className="cardForms">
      <div><h3>Novo cartão</h3><label>Nome<input value={cardName} onChange={e => setCardName(e.target.value)} placeholder="Cartão principal"/></label><div className="fieldPair"><label>Fechamento<input type="number" min="1" max="31" value={closing} onChange={e => setClosing(e.target.value)}/></label><label>Vencimento<input type="number" min="1" max="31" value={due} onChange={e => setDue(e.target.value)}/></label></div><button className="secondary" onClick={() => void addCard()} disabled={!cardName.trim()}>Cadastrar cartão</button></div>
      <div><h3>Nova compra</h3><label>Cartão<select value={purchaseCard} onChange={e => setPurchaseCard(e.target.value)}><option value="">Selecione</option>{cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Descrição<input value={purchaseDescription} onChange={e => setPurchaseDescription(e.target.value)} placeholder="Ex.: Notebook"/></label><div className="fieldPair"><label>Valor total<input value={purchaseAmount} onChange={e => setPurchaseAmount(e.target.value)} placeholder="399,90"/></label><label>Parcelas<input type="number" min="1" max="120" value={count} onChange={e => setCount(e.target.value)}/></label></div><button className="secondary" onClick={() => void addPurchase()} disabled={!purchaseCard || !purchaseDescription.trim() || !purchaseAmount}>Registrar compra</button></div>
      <div><h3>Pagar fatura</h3><label>Fatura<select value={paymentInvoice} onChange={e => setPaymentInvoice(e.target.value)}><option value="">Selecione</option>{open.map(i => <option key={i.id} value={i.id}>{cards.find(c => c.id === i.card_id)?.name} · {i.period.slice(0,7)} · {formatBrl(i.total-i.paid)} pendente</option>)}</select></label><label>Conta<select value={paymentAccount} onChange={e => setPaymentAccount(e.target.value)}><option value="">Selecione</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>Valor pago<input value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} placeholder="100,00"/></label><button className="secondary" onClick={() => void payInvoice()} disabled={!paymentInvoice || !paymentAccount || !paymentAmount}>Registrar pagamento</button></div>
    </div>
    <div className="list">{invoices.slice(0, 10).map(i => { const total = installments.filter(p => p.invoice_id === i.id).reduce((n,p)=>n+p.amount_cents,0); const paid = payments.filter(p=>p.invoice_id===i.id).reduce((n,p)=>n+p.amount_cents,0); return <div className="listRow" key={i.id}><div className="rowMain"><b>{cards.find(c=>c.id===i.card_id)?.name ?? 'Cartão'} · {i.period.slice(0,7)}</b><small>Vence em {i.due_on.split('-').reverse().join('/')} · Pago {formatBrl(paid)}</small></div><strong>{formatBrl(total - paid)} pendente</strong></div>; })}</div>
  </section>;
}
