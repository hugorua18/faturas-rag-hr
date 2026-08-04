import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

// Chaveado pela chave estável da categoria (ExpenseCategory.key / Expense.type).
// Só cobre as categorias seed antigas — categorias novas criadas pelo
// utilizador não têm entrada aqui e usam o ícone genérico (ver DEFAULT_EXPENSE_TYPE_ICON).
export const EXPENSE_TYPE_ICONS: Partial<Record<string, IoniconName>> = {
  REFEICOES: 'restaurant-outline',
  TRANSPORTE_DESLOCACOES: 'bus-outline',
  COMBUSTIVEL: 'flame-outline',
  ALOJAMENTO: 'bed-outline',
  COMUNICACOES: 'call-outline',
  LIVROS: 'book-outline',
  CPAS: 'briefcase-outline',
  MANICURE: 'sparkles-outline',
  OUTROS: 'ellipsis-horizontal-outline',
};

export const DEFAULT_EXPENSE_TYPE_ICON: IoniconName = 'pricetag-outline';
