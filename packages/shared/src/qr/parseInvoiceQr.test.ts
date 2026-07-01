import { describe, expect, it } from 'vitest';
import { parseInvoiceQr } from './parseInvoiceQr';

describe('parseInvoiceQr', () => {
  it('extrai os campos principais de um QR de fatura normal (Continente, taxa normal)', () => {
    const qr =
      'A:123456789*B:999999990*C:PT*D:FT*E:N*F:20260701*G:FT SERIEA/123*' +
      'H:ABC12345-123*I1:PT*I7:23.65*I8:5.29*N:5.29*O:28.94*Q:aB3d*R:1234*S:';

    const result = parseInvoiceQr(qr);

    expect(result).not.toBeNull();
    expect(result?.issuerNif).toBe('123456789');
    expect(result?.acquirerNif).toBe('999999990');
    expect(result?.acquirerCountry).toBe('PT');
    expect(result?.documentType).toBe('FT');
    expect(result?.documentDate).toBe('2026-07-01');
    expect(result?.atcud).toBe('ABC12345-123');
    expect(result?.vatAmount).toBeCloseTo(5.29);
    expect(result?.totalAmount).toBeCloseTo(28.94);
    expect(result?.baseAmount).toBeCloseTo(23.65);
  });

  it('lida com faturas isentas de IVA (vatAmount = 0)', () => {
    const qr = 'A:500000000*B:999999990*C:PT*D:FT*F:20260615*I1:PT*I2:100.00*N:0*O:100.00*Q:xy12*R:9999';

    const result = parseInvoiceQr(qr);

    expect(result?.vatAmount).toBe(0);
    expect(result?.totalAmount).toBe(100);
    expect(result?.baseAmount).toBe(100);
  });

  it('lida com faturas com NIF do adquirente específico (não consumidor final)', () => {
    const qr = 'A:501234567*B:509876543*C:PT*D:FT*F:20260301*N:12.65*O:71.65*Q:qwer*R:42';

    const result = parseInvoiceQr(qr);

    expect(result?.acquirerNif).toBe('509876543');
    expect(result?.baseAmount).toBeCloseTo(59);
  });

  it('devolve null para texto que não tem a forma de um QR de fatura', () => {
    expect(parseInvoiceQr('https://exemplo.pt/algo')).toBeNull();
    expect(parseInvoiceQr('')).toBeNull();
  });

  it('devolve null quando falta o NIF do emitente (campo A)', () => {
    expect(parseInvoiceQr('B:999999990*C:PT*D:FT*F:20260301*N:1*O:2')).toBeNull();
  });

  it('preserva todos os campos brutos, incluindo os de detalhe por taxa/região', () => {
    const qr = 'A:123456789*B:999999990*C:PT*D:FT*F:20260701*I1:PT*I7:23.65*I8:5.29*N:5.29*O:28.94*S:algo';

    const result = parseInvoiceQr(qr);

    expect(result?.rawFields.I7).toBe('23.65');
    expect(result?.rawFields.I8).toBe('5.29');
    expect(result?.otherInfo).toBe('algo');
  });
});
