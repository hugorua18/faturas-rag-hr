export const EXPENSE_TYPES = [
  'REFEICOES',
  'TRANSPORTE_DESLOCACOES',
  'COMBUSTIVEL',
  'ALOJAMENTO',
  'COMUNICACOES',
  'LIVROS',
  'CPAS',
  'MANICURE',
  'OUTROS',
] as const;

export type ExpenseType = (typeof EXPENSE_TYPES)[number];

export const EXPENSE_TYPE_LABELS: Record<ExpenseType, string> = {
  REFEICOES: 'Refeições',
  TRANSPORTE_DESLOCACOES: 'Transporte/Deslocações',
  COMBUSTIVEL: 'Combustível',
  ALOJAMENTO: 'Alojamento',
  COMUNICACOES: 'Comunicações',
  LIVROS: 'Livros',
  CPAS: 'CPAS',
  MANICURE: 'Manicure',
  OUTROS: 'Outros',
};

export function isExpenseType(value: string): value is ExpenseType {
  return (EXPENSE_TYPES as readonly string[]).includes(value);
}

// Categoria de despesa personalizada por utilizador (ver ExpenseCategory no
// schema Prisma) — `key` é o identificador estável gravado em Expense.type,
// `label` é o nome editável, `vatDeductible` é opcional (null = não
// classificada). EXPENSE_TYPES/EXPENSE_TYPE_LABELS acima continuam a existir
// só como o conjunto inicial ("seed") copiado para cada utilizador novo.
export interface ExpenseCategory {
  id: string;
  key: string;
  label: string;
  vatDeductible: boolean | null;
  sortOrder: number;
  /** Nº de despesas do utilizador com este `key` — só vem preenchido em GET /categories,
   * usado para avisar antes de eliminar/alterar uma categoria já usada (ver categories/index.tsx). */
  expenseCount?: number;
}

// Deriva um `key` estável em SCREAMING_SNAKE_CASE a partir do nome escrito
// pelo utilizador ao criar uma categoria nova — mesma convenção das chaves
// fixas em EXPENSE_TYPES (ex: "Vinhos & Bebidas" → "VINHOS_BEBIDAS").
export function slugifyCategoryKey(label: string): string {
  const base = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || 'CATEGORIA';
}
