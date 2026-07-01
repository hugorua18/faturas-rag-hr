import { NO_DATE_KEY, NO_NIF_KEY } from '@invoice-scanner/shared';

const MONTH_NAMES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

export function formatNifLabel(nif: string): string {
  return nif === NO_NIF_KEY ? 'Sem NIF' : `NIF ${nif}`;
}

/** `period` no formato "AAAA-MM" (ou o sentinela de "sem data"). */
export function formatPeriodLabel(period: string): string {
  if (period === NO_DATE_KEY) return 'Sem data';
  const [year, month] = period.split('-').map(Number);
  const monthName = MONTH_NAMES[(month ?? 1) - 1] ?? period;
  return `${monthName} ${year}`;
}

export function formatCurrency(amount: number | null | undefined): string {
  return amount !== undefined && amount !== null ? `${amount.toFixed(2)} €` : '—';
}
