import { z } from 'zod';

export const transactionInput = z.object({
  kind: z.enum(['income', 'expense', 'transfer', 'refund', 'adjustment']),
  amount_cents: z.number().int().positive().safe(),
  description: z.string().trim().min(1).max(160),
  occurred_on: z.iso.date(),
  account_id: z.uuid(),
  category_id: z.uuid().nullable().optional(),
  status: z.enum(['pending', 'settled']).default('settled'),
  idempotency_key: z.uuid()
});

export const accountInput = z.object({
  name: z.string().trim().min(1).max(80),
  opening_balance_cents: z.number().int().safe().nullable(),
  opening_date: z.iso.date().nullable()
}).refine(value => (value.opening_balance_cents === null) === (value.opening_date === null), {
  message: 'Saldo inicial e data precisam ser informados juntos.'
});

export const eventInput = z.object({
  title: z.string().trim().min(1).max(160),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
  description: z.string().max(1000).default('')
}).refine(value => Date.parse(value.ends_at) > Date.parse(value.starts_at), {
  message: 'O término deve ocorrer após o início.'
});

export const reportPeriod = z.object({
  from: z.iso.date(),
  to: z.iso.date()
}).refine(value => value.from <= value.to &&
  (Date.parse(value.to) - Date.parse(value.from)) <= 366 * 86_400_000, {
  message: 'Selecione um período válido de até 366 dias.'
});

export function parseBrlCents(input: string): number {
  const normalized = input.trim().replace(/^R\$\s*/, '').replace(/\s/g, '');
  if (!/^-?(?:\d{1,3}(?:\.\d{3})*|\d+)(?:,\d{1,2})?$/.test(normalized)) {
    throw new Error('Informe reais como 100, 100,50 ou 1.000,50.');
  }
  const negative = normalized.startsWith('-');
  const unsigned = normalized.replace(/^-/, '');
  const [reais, centavos] = unsigned.split(',');
  const result = Number(reais!.replace(/\./g, '')) * 100 + Number((centavos ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) throw new Error('Valor fora do limite permitido.');
  return negative ? -result : result;
}

export function formatBrl(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error('Valor inválido.');
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

export function installments(totalCents: number, count: number): number[] {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || !Number.isInteger(count) || count < 1 || count > 120) {
    throw new Error('Compra ou número de parcelas inválido.');
  }
  const base = Math.floor(totalCents / count);
  return Array.from({ length: count }, (_, index) => index === count - 1 ? totalCents - base * (count - 1) : base);
}

export type LedgerRow = {
  kind: 'income' | 'expense' | 'transfer' | 'refund' | 'adjustment' | 'invoice_payment';
  amount_cents: number;
  status: 'pending' | 'settled';
};

export function summarizeLedger(rows: LedgerRow[]) {
  let income = 0, spending = 0, cashOut = 0, transfers = 0, refunds = 0;
  for (const row of rows) {
    if (row.kind === 'income') income += row.amount_cents;
    if (row.kind === 'expense') spending += row.amount_cents;
    if (row.kind === 'refund') refunds += row.amount_cents;
    if (row.kind === 'transfer') transfers += row.amount_cents;
    if (row.status === 'settled' && (row.kind === 'expense' || row.kind === 'invoice_payment')) cashOut += row.amount_cents;
  }
  return { income, spending, cashOut, transfers, refunds };
}

export function nextDeliveryAt(previous: Date): Date {
  if (Number.isNaN(previous.getTime())) throw new Error('Data inválida.');
  return new Date(previous.getTime() + 30 * 86_400_000);
}
