// Regras de coerência de uma despesa, partilhadas entre a app (feedback
// imediato no formulário) e o servidor (validação autoritativa).

// Tolerância de 1 cêntimo (+ margem de vírgula flutuante): faturas com várias
// taxas de IVA arredondam cada parcela separadamente e o total pode diferir
// da soma por um cêntimo de forma perfeitamente legítima.
export const AMOUNT_CONSISTENCY_TOLERANCE = 0.011;

/**
 * Verifica "base + IVA = total". Só reprova quando os TRÊS valores estão
 * preenchidos e a soma não bate certo — com campos em falta não há juízo a
 * fazer (o preenchimento parcial é permitido no tratamento manual).
 */
export function amountsAreConsistent(
  amountBase: number | null | undefined,
  amountVat: number | null | undefined,
  amountTotal: number | null | undefined,
): boolean {
  if (amountBase == null || amountVat == null || amountTotal == null) return true;
  return Math.abs(amountBase + amountVat - amountTotal) <= AMOUNT_CONSISTENCY_TOLERANCE;
}

/**
 * O NIF do prestador (emitente) e o NIF do utente (adquirente) nunca podem
 * ser o mesmo — ninguém fatura a si próprio; quando acontece é engano de
 * preenchimento (ou OCR a apanhar o NIF errado).
 */
export function nifsAreDistinct(
  supplierNif: string | null | undefined,
  acquirerNif: string | null | undefined,
): boolean {
  const supplier = (supplierNif ?? '').trim();
  const acquirer = (acquirerNif ?? '').trim();
  if (!supplier || !acquirer) return true;
  return supplier !== acquirer;
}
