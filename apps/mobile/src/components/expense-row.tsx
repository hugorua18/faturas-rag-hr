import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Swipeable } from 'react-native-gesture-handler';
import { EXPENSE_TYPE_LABELS, isExpenseType, type Expense, type ExpenseCategory } from '@invoice-scanner/shared';

import type { useTheme } from '@/hooks/use-theme';
import { resolveFileUrl } from '@/api/client';
import { DEFAULT_EXPENSE_TYPE_ICON, EXPENSE_TYPE_ICONS } from '@/constants/expense-type-icons';
import { formatCurrency } from '@/utils/format';

type Theme = ReturnType<typeof useTheme>;

// Linha de despesa com deslizar-para-eliminar, partilhada entre a listagem de
// um mês (expenses/[nif]/[period].tsx) e os resultados da busca entre meses
// (expenses/[nif]/index.tsx) — mesmo visual e comportamento nos dois sítios.
export function ExpenseRow({
  theme,
  expense,
  categories,
  onDelete,
  swipeableRef,
}: {
  theme: Theme;
  expense: Expense;
  categories: ExpenseCategory[];
  onDelete: (expense: Expense) => void;
  swipeableRef?: (ref: Swipeable | null) => void;
}) {
  const type = expense.type;
  const categoryLabel =
    categories.find((c) => c.key === type)?.label ?? (isExpenseType(type) ? EXPENSE_TYPE_LABELS[type] : type);

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={() => (
        <Pressable
          style={[styles.deleteAction, { backgroundColor: theme.destructive }]}
          onPress={() => onDelete(expense)}
        >
          <Ionicons name="trash-outline" size={22} color="#FFFFFF" />
        </Pressable>
      )}
    >
      <Pressable
        style={[styles.row, { backgroundColor: theme.card }]}
        onPress={() => router.push(`/expense/${expense.id}`)}
      >
        {expense.fileUrl ? (
          <Image source={{ uri: resolveFileUrl(expense.fileUrl) }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder, { backgroundColor: theme.backgroundElement }]}>
            <Ionicons name={EXPENSE_TYPE_ICONS[type] ?? DEFAULT_EXPENSE_TYPE_ICON} size={20} color={theme.textSecondary} />
          </View>
        )}
        <View style={styles.rowInfo}>
          <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
            {expense.supplierName || 'Fornecedor não indicado'}
          </Text>
          <Text style={[styles.rowSubtitle, { color: theme.textSecondary }]}>
            {categoryLabel} · {expense.documentDate || 'sem data'}
          </Text>
        </View>
        <View style={styles.rowTrailing}>
          <Text style={[styles.rowAmount, { color: theme.text }]}>{formatCurrency(expense.amountTotal)}</Text>
          <Ionicons name="chevron-forward" size={16} color={theme.separator} />
        </View>
      </Pressable>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14 },
  thumb: { width: 48, height: 48, borderRadius: 10 },
  thumbPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  rowInfo: { flex: 1, gap: 2, justifyContent: 'center' },
  rowTitle: { fontSize: 15.5, fontWeight: '600' },
  rowSubtitle: { fontSize: 13 },
  rowTrailing: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowAmount: { fontSize: 15, fontWeight: '600' },
  deleteAction: {
    width: 72,
    marginLeft: 8,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
