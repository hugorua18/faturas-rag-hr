import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import type { ExpenseType } from '@invoice-scanner/shared';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export const EXPENSE_TYPE_ICONS: Record<ExpenseType, IoniconName> = {
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
