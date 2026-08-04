import type { Expense } from '@invoice-scanner/shared';
import { parseDecimal } from './number';

// Filtros aplicados client-side sobre uma lista de despesas já carregada —
// tanto na listagem de um mês (expenses/[nif]/[period].tsx) como nos
// resultados da busca entre meses (expenses/[nif]/index.tsx). "categoryKeys"
// vazio = todas as categorias; datas/valores vazios = sem limite nesse lado.
export interface ExpenseFilterState {
  supplierQuery: string;
  categoryKeys: string[];
  dateFrom: string;
  dateTo: string;
  amountMin: string;
  amountMax: string;
}

export const EMPTY_EXPENSE_FILTERS: ExpenseFilterState = {
  supplierQuery: '',
  categoryKeys: [],
  dateFrom: '',
  dateTo: '',
  amountMin: '',
  amountMax: '',
};

export function hasActiveFilters(filters: ExpenseFilterState): boolean {
  return (
    filters.supplierQuery.trim() !== '' ||
    filters.categoryKeys.length > 0 ||
    filters.dateFrom !== '' ||
    filters.dateTo !== '' ||
    filters.amountMin.trim() !== '' ||
    filters.amountMax.trim() !== ''
  );
}

// Datas ISO (YYYY-MM-DD) comparam-se corretamente como texto, tal como já é
// feito nos endpoints de relatório por intervalo (ver loadRangeReportData no
// servidor) — não é preciso construir objetos Date para isto.
export function applyExpenseFilters(expenses: Expense[], filters: ExpenseFilterState): Expense[] {
  const query = filters.supplierQuery.trim().toLowerCase();
  const min = parseDecimal(filters.amountMin);
  const max = parseDecimal(filters.amountMax);

  return expenses.filter((expense) => {
    if (query) {
      const haystack = `${expense.supplierName ?? ''} ${expense.supplierNif ?? ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (filters.categoryKeys.length > 0 && !filters.categoryKeys.includes(expense.type)) return false;
    if (filters.dateFrom && (!expense.documentDate || expense.documentDate < filters.dateFrom)) return false;
    if (filters.dateTo && (!expense.documentDate || expense.documentDate > filters.dateTo)) return false;
    if (min !== undefined || max !== undefined) {
      // Um valor desconhecido não "bate certo" com um filtro de valor — tratá-lo
      // como 0 fazia-o desaparecer silenciosamente de "valor mínimo" (em vez de
      // ficar de fora, sinalizado, à espera de revisão).
      if (expense.amountTotal === undefined || expense.amountTotal === null) return false;
      if (min !== undefined && expense.amountTotal < min) return false;
      if (max !== undefined && expense.amountTotal > max) return false;
    }
    return true;
  });
}
