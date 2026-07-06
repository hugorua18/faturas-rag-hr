// O teclado decimal em locale PT insere VÍRGULA ("12,50") — e Number("12,50")
// é NaN, que o JSON.stringify converte em null, fazendo o servidor descartar
// o valor em silêncio ("preenchi e não guardou"). Este parser aceita ambas as
// convenções: "12,50", "12.50" e "1.234,56" (ponto como separador de milhares
// quando existe vírgula decimal).
export function parseDecimal(value: string): number | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  let normalized = raw.replace(/[€\s]/g, '');
  if (normalized.includes(',')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}
