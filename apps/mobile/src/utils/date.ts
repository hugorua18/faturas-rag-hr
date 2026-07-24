// A app usa 'YYYY-MM-DD' como formato canónico em todo o lado (submissão,
// relatórios, filtros). new Date('YYYY-MM-DD') do JS interpreta a string como
// meia-noite UTC — perto da fronteira do fuso horário isso troca o dia
// exibido. parseIsoDate/toIsoDateString constroem e leem a data em hora
// LOCAL, de propósito, para nunca haver esse desvio de um dia.
export function parseIsoDate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toIsoDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// Rótulo curto para o campo de data ("23 jul 2026") — o valor guardado
// continua em 'YYYY-MM-DD'; isto é só para exibição.
export function formatDateLabel(value: string): string {
  const date = parseIsoDate(value);
  if (!date) return value;
  return `${date.getDate()} ${MONTHS_PT[date.getMonth()]} ${date.getFullYear()}`;
}
