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
