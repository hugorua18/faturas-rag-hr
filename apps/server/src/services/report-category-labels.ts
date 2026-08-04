import { EXPENSE_TYPE_LABELS, isExpenseType, type ExpenseCategory } from '@invoice-scanner/shared';

// Partilhado entre report-pdf.service.ts e report-excel.service.ts — ambos
// precisam de resolver Expense.type (uma chave em bruto) para o nome da
// categoria correspondente do utilizador.
export function toCategoryMap(categories: ExpenseCategory[]): Map<string, ExpenseCategory> {
  return new Map(categories.map((c) => [c.key, c]));
}

// Categoria pode ter sido apagada entretanto (Expense.type é uma string
// solta, sem FK) — cai para a etiqueta fixa antiga (se a chave coincidir com
// um EXPENSE_TYPES original) e por fim para a própria chave em bruto.
export function categoryLabel(categories: Map<string, ExpenseCategory>, type: string): string {
  return categories.get(type)?.label ?? (isExpenseType(type) ? EXPENSE_TYPE_LABELS[type] : type);
}

// Cada fatura guarda a sua própria classificação (Expense.vatDeductible) — os
// relatórios nunca a derivam da categoria, para não retroagir sobre faturas já
// submetidas quando a categoria muda depois (ver vat-learning.service.ts).
export function vatDeductibleLabel(vatDeductible: boolean | null | undefined): string {
  if (vatDeductible === true) return 'Sim';
  if (vatDeductible === false) return 'Não';
  return '—';
}

// As colunas de IVA dedutível só aparecem nos relatórios quando a conta tem a
// classificação ativa (User.vatClassificationEnabled) — para quem nunca a
// liga, os relatórios ficam exatamente como sempre foram.
export function shouldShowVatDeductible(vatClassificationEnabled: boolean): boolean {
  return vatClassificationEnabled;
}
