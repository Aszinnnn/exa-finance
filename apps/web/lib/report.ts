import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { formatBrl } from '@exa/domain';
import { serverDb } from './server-supabase';

type Movement = { kind: string; amount_cents: number; description: string; occurred_on: string; status: string; account_id: string };
type Account = { id: string; name: string; opening_balance_cents: number | null; opening_date: string | null };
type Card = { id: string; name: string; closing_day: number };
type Invoice = { id: string; card_id: string; period: string; due_on: string };
type Purchase = { id: string; description: string; installment_count: number };
type Installment = { invoice_id: string; purchase_id: string; number: number; amount_cents: number };
type InvoicePayment = { invoice_id: string; amount_cents: number; paid_on: string };

function closeDate(period: string, day: number) {
  const [year, month] = period.split('-').map(Number);
  const last = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

export async function generateReport(userId: string, from: string, to: string): Promise<Uint8Array> {
  const db = serverDb();
  const [transactions, accounts, profile, cardsResult, invoicesResult, purchasesResult, installmentsResult, paymentsResult] = await Promise.all([
    db.from('transactions').select('kind,amount_cents,description,occurred_on,status,account_id', { count: 'exact' }).eq('user_id', userId).is('deleted_at', null).lte('occurred_on', to).order('occurred_on'),
    db.from('financial_accounts').select('id,name,opening_balance_cents,opening_date', { count: 'exact' }).eq('user_id', userId).is('deleted_at', null),
    db.from('profiles').select('display_name').eq('id', userId).single(),
    db.from('credit_cards').select('id,name,closing_day', { count: 'exact' }).eq('user_id', userId),
    db.from('invoices').select('id,card_id,period,due_on', { count: 'exact' }).eq('user_id', userId),
    db.from('card_purchases').select('id,description,installment_count', { count: 'exact' }).eq('user_id', userId),
    db.from('card_installments').select('invoice_id,purchase_id,number,amount_cents', { count: 'exact' }).eq('user_id', userId),
    db.from('invoice_payments').select('invoice_id,amount_cents,paid_on', { count: 'exact' }).eq('user_id', userId).lte('paid_on', to)
  ]);
  const error = transactions.error ?? accounts.error ?? profile.error ?? cardsResult.error ?? invoicesResult.error ?? purchasesResult.error ?? installmentsResult.error ?? paymentsResult.error;
  if (error) throw new Error('Não foi possível consultar dados para o relatório.');
  for (const result of [transactions, accounts, cardsResult, invoicesResult, purchasesResult, installmentsResult, paymentsResult]) {
    if (result.count === null || result.count > (result.data?.length ?? 0)) throw new Error('Relatório excede o limite de registros retornados.');
  }
  const all = transactions.data as Movement[];
  const inPeriod = all.filter(t => t.occurred_on >= from && t.occurred_on <= to);
  const previousDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  const prevTo = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const prevFrom = new Date(Date.parse(`${from}T00:00:00Z`) - previousDays * 86_400_000).toISOString().slice(0, 10);
  const previous = all.filter(t => t.occurred_on >= prevFrom && t.occurred_on <= prevTo);
  const cards = cardsResult.data as Card[];
  const invoices = invoicesResult.data as Invoice[];
  const purchases = purchasesResult.data as Purchase[];
  const installments = installmentsResult.data as Installment[];
  const invoicePayments = paymentsResult.data as InvoicePayment[];
  const datedInstallments = installments.map(part => {
    const invoice = invoices.find(item => item.id === part.invoice_id);
    const card = cards.find(item => item.id === invoice?.card_id);
    return { ...part, invoice, card, date: invoice && card ? closeDate(invoice.period, card.closing_day) : null };
  });
  const cardInPeriod = datedInstallments.filter(item => item.date && item.date >= from && item.date <= to);
  const cardPrevious = datedInstallments.filter(item => item.date && item.date >= prevFrom && item.date <= prevTo);
  const sum = (rows: Movement[], kind: string) => rows.filter(t => t.kind === kind).reduce((n, t) => n + t.amount_cents, 0);
  const income = sum(inPeriod, 'income');
  const spending = sum(inPeriod, 'expense') + cardInPeriod.reduce((n, item) => n + item.amount_cents, 0);
  const refunds = sum(inPeriod, 'refund');
  const payments = sum(inPeriod, 'invoice_payment');
  const transfers = sum(inPeriod, 'transfer');
  const prevSpending = sum(previous, 'expense') + cardPrevious.reduce((n, item) => n + item.amount_cents, 0);
  const hasPriorData = previous.length > 0 || cardPrevious.length > 0;
  const allAccounts = accounts.data as Account[];
  const balanceKnown = allAccounts.length > 0 && allAccounts.every(a => a.opening_balance_cents !== null && a.opening_date !== null && a.opening_date <= to);
  const balance = allAccounts.reduce((n, a) => n + (a.opening_balance_cents ?? 0), 0) + all.filter(t => t.status === 'settled').reduce((n, t) => n + (t.kind === 'income' || t.kind === 'refund' ? t.amount_cents : t.kind === 'expense' || t.kind === 'invoice_payment' ? -t.amount_cents : 0), 0);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.18, 0.17);
  const muted = rgb(0.40, 0.48, 0.46);
  const green = rgb(0.13, 0.38, 0.29);
  let page = pdf.addPage([595, 842]);
  let y = 790;
  const newPage = () => { page = pdf.addPage([595, 842]); y = 790; };
  const line = (value: string, size = 10, emphasize = false, color = ink) => {
    if (y < 65) newPage();
    const safe = value.replace(/[\u2013\u2014]/g, '-').replace(/[^\u0020-\u00FF]/g, '');
    page.drawText(safe, { x: 45, y, size, font: emphasize ? bold : font, color, maxWidth: 500 });
    y -= size + 8;
  };
  const heading = (value: string) => { y -= 14; line(value, 13, true, green); };
  const date = (value: string) => value.split('-').reverse().join('/');
  const desc = (value: string) => value.length > 64 ? `${value.slice(0, 61)}...` : value;

  line('EXA  |  RELATORIO FINANCEIRO', 18, true, green);
  line(`${date(from)} a ${date(to)}  |  BRL`, 11, true);
  line(`Titular: ${profile.data?.display_name || 'Usuario EXA'}`, 10);
  line(`Gerado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, 9, false, muted);
  heading('Resumo');
  line(`Entradas: ${formatBrl(income)}`);
  line(`Gastos de consumo (diretos e parcelas): ${formatBrl(spending)}`);
  line(`Pagamentos de fatura: ${formatBrl(payments)} (saida de caixa, nao novo consumo)`);
  line(`Estornos/reembolsos: ${formatBrl(refunds)}`);
  line(`Transferencias: ${formatBrl(transfers)} (nao afetam resultado liquido)`);
  line(`Saldo final: ${balanceKnown ? formatBrl(balance) : 'Nao configurado'}`);
  if (!balanceKnown) line('Informe saldo inicial e data em todas as contas para calcular saldo final.', 9, false, muted);
  heading('Comparacao com periodo anterior equivalente');
  if (!hasPriorData) line('Sem dados suficientes no periodo anterior para comparar.', 10, false, muted);
  else {
    line(`Gasto anterior (${date(prevFrom)} a ${date(prevTo)}): ${formatBrl(prevSpending)}`);
    const diff = spending - prevSpending;
    line(`Diferenca: ${diff >= 0 ? '+' : '-'}${formatBrl(Math.abs(diff))}`);
    line(prevSpending === 0 ? 'Variacao percentual: sem base comparavel.' :
      `Variacao percentual: ${((diff / Math.abs(prevSpending)) * 100).toFixed(1).replace('.', ',')}%`);
  }
  heading('Movimentacoes detalhadas');
  if (!inPeriod.length) line('Nenhuma movimentacao registrada no periodo.', 10, false, muted);
  for (const movement of inPeriod) {
    const account = allAccounts.find(a => a.id === movement.account_id)?.name ?? 'Conta';
    line(`${date(movement.occurred_on)}  ${desc(movement.description)}`, 9, true);
    line(`${account}  |  ${movement.kind}  |  ${movement.status}  |  ${formatBrl(movement.amount_cents)}`, 8, false, muted);
  }
  heading('Compras no cartao por competencia');
  if (!cardInPeriod.length) line('Nenhuma parcela com fechamento neste periodo.', 10, false, muted);
  for (const part of cardInPeriod) {
    const purchase = purchases.find(item => item.id === part.purchase_id);
    line(`${date(part.date!)}  ${desc(purchase?.description ?? 'Compra')}`, 9, true);
    line(`${part.card?.name ?? 'Cartao'}  |  ${part.number}/${purchase?.installment_count ?? '?'}  |  ${formatBrl(part.amount_cents)}`, 8, false, muted);
  }
  heading('Faturas com fechamento no periodo');
  const currentInvoices = invoices.filter(invoice => {
    const card = cards.find(item => item.id === invoice.card_id);
    if (!card) return false;
    const closed = closeDate(invoice.period, card.closing_day);
    return closed >= from && closed <= to;
  });
  if (!currentInvoices.length) line('Nenhuma fatura neste periodo.', 10, false, muted);
  for (const invoice of currentInvoices) {
    const card = cards.find(item => item.id === invoice.card_id);
    const total = installments.filter(item => item.invoice_id === invoice.id).reduce((n, item) => n + item.amount_cents, 0);
    const paid = invoicePayments.filter(item => item.invoice_id === invoice.id).reduce((n, item) => n + item.amount_cents, 0);
    line(`${card?.name ?? 'Cartao'}  |  ${invoice.period.slice(0, 7)}  |  vence ${date(invoice.due_on)}`, 9, true);
    line(`Total ${formatBrl(total)}  |  Pago ${formatBrl(paid)}  |  Pendente ${formatBrl(total - paid)}`, 8, false, muted);
  }
  y -= 12;
  line('Valores baseados exclusivamente nos lancamentos registrados no EXA.', 8, false, muted);
  if (balanceKnown) line('Saldo inclui somente lancamentos liquidados ate o fim do periodo.', 8, false, muted);
  const pages = pdf.getPages();
  pages.forEach((item, index) => item.drawText(`${index + 1} / ${pages.length}`, { x: 520, y: 28, size: 8, font, color: muted }));
  return pdf.save();
}
