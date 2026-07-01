export interface ParsedInvoiceQr {
  issuerNif: string;
  acquirerNif: string;
  acquirerCountry: string;
  documentType: string;
  documentStatus: string;
  /** ISO date (YYYY-MM-DD), normalized from the QR's AAAAMMDD field. */
  documentDate: string;
  documentId: string;
  atcud: string;
  fiscalSpace: string;
  /** Valor do IVA (campo N). */
  vatAmount: number | null;
  /** Valor com IVA (campo O). */
  totalAmount: number | null;
  /** Valor sem IVA, derivado de O - N (o standard não expõe este valor diretamente). */
  baseAmount: number | null;
  hashChars: string;
  softwareCertificateNumber: string;
  otherInfo: string;
  /** Todos os pares chave/valor tal como vieram no QR, incluindo os campos de detalhe por taxa (I2-I8, J1-J8, K1-K8) não modelados individualmente acima. */
  rawFields: Record<string, string>;
}

function normalizeDate(value: string | undefined): string {
  if (!value || !/^\d{8}$/.test(value)) return '';
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function parseAmount(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const normalized = Number(value.replace(',', '.'));
  return Number.isFinite(normalized) ? normalized : null;
}

/**
 * Faturas portuguesas (Portaria 195/2020, AT) codificam o QR como uma
 * sequência de pares "chave:valor" separados por "*", ex:
 * "A:123456789*B:999999990*C:PT*D:FT*F:20260701*...*N:5.29*O:29.30*..."
 *
 * O standard não inclui a hora da fatura — só a data (campo F).
 */
export function parseInvoiceQr(rawQrText: string): ParsedInvoiceQr | null {
  if (!rawQrText || !rawQrText.includes(':')) return null;

  const rawFields: Record<string, string> = {};
  for (const segment of rawQrText.split('*')) {
    const separatorIndex = segment.indexOf(':');
    if (separatorIndex === -1) continue;
    const key = segment.slice(0, separatorIndex).trim();
    const value = segment.slice(separatorIndex + 1).trim();
    if (key) rawFields[key] = value;
  }

  // Sanity check: sem NIF do emitente, isto não é um QR de fatura válido.
  if (!rawFields.A) return null;

  const vatAmount = parseAmount(rawFields.N);
  const totalAmount = parseAmount(rawFields.O);
  const baseAmount =
    vatAmount !== null && totalAmount !== null
      ? Math.round((totalAmount - vatAmount) * 100) / 100
      : null;

  return {
    issuerNif: rawFields.A ?? '',
    acquirerNif: rawFields.B ?? '',
    acquirerCountry: rawFields.C ?? '',
    documentType: rawFields.D ?? '',
    documentStatus: rawFields.E ?? '',
    documentDate: normalizeDate(rawFields.F),
    documentId: rawFields.G ?? '',
    atcud: rawFields.H ?? '',
    fiscalSpace: rawFields.I1 ?? '',
    vatAmount,
    totalAmount,
    baseAmount,
    hashChars: rawFields.Q ?? '',
    softwareCertificateNumber: rawFields.R ?? '',
    otherInfo: rawFields.S ?? '',
    rawFields,
  };
}
