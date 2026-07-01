export interface EurConversionResult {
  amountBase?: number;
  amountVat?: number;
  amountTotal: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A partir dos valores na moeda original e do total em EUR introduzido
 * manualmente, deriva base/IVA em EUR aplicando o mesmo fator de câmbio
 * (assume-se que o IVA tem a mesma taxa efetiva em ambas as moedas).
 * Devolve null enquanto não há dados suficientes para calcular (total
 * original em falta/zero ou total em EUR ainda não preenchido).
 */
export function convertToEur(
  originalBase: string,
  originalVat: string,
  originalTotal: string,
  eurTotal: string,
): EurConversionResult | null {
  const total = Number(originalTotal);
  const eur = Number(eurTotal);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(eur) || eur <= 0) return null;

  const factor = eur / total;
  const base = Number(originalBase);
  const vat = Number(originalVat);

  return {
    amountBase: Number.isFinite(base) ? round2(base * factor) : undefined,
    amountVat: Number.isFinite(vat) ? round2(vat * factor) : undefined,
    amountTotal: round2(eur),
  };
}
