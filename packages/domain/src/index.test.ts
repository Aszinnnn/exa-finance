import { describe, expect, it } from 'vitest';
import { installments, nextDeliveryAt, parseBrlCents, summarizeLedger } from './index';

describe('regras financeiras', () => {
  it('converte BRL em centavos sem ponto flutuante de entrada', () => {
    expect(parseBrlCents('R$ 1.234,56')).toBe(123456);
    expect(() => parseBrlCents('39.9')).toThrow();
  });
  it('distribui centavos com soma exata', () => {
    expect(installments(1000, 3)).toEqual([333, 333, 334]);
  });
  it('separa gasto de consumo de pagamento de fatura', () => {
    expect(summarizeLedger([
      { kind: 'expense', amount_cents: 1000, status: 'pending' },
      { kind: 'invoice_payment', amount_cents: 1000, status: 'settled' }
    ])).toMatchObject({ spending: 1000, cashOut: 1000 });
  });
});

it('avança exatamente 30 dias desde o ciclo anterior', () => {
  expect(nextDeliveryAt(new Date('2026-10-11T09:00:00Z')).toISOString()).toBe('2026-11-10T09:00:00.000Z');
});
