import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Swipeable } from 'react-native-gesture-handler';
import { REPORT_STATUS_COLORS, REPORT_STATUS_LABELS, type Expense, type ReportStatus } from '@invoice-scanner/shared';

import { useTheme } from '@/hooks/use-theme';
import { deleteExpense, listExpenses, listMonthlySummaries, updateReportStatus } from '@/api/client';
import { useExpenseCategories } from '@/hooks/use-expense-categories';
import { ExpenseRow } from '@/components/expense-row';
import { ExpenseFilterPanel } from '@/components/expense-filter-panel';
import { applyExpenseFilters, EMPTY_EXPENSE_FILTERS, hasActiveFilters, type ExpenseFilterState } from '@/utils/expense-filters';
import { formatPeriodLabel } from '@/utils/format';
import { confirmAction, notify } from '@/utils/alert';

const NEXT_STATUS: Record<ReportStatus, ReportStatus> = {
  ABERTO: 'ENVIADO_CONTABILISTA',
  ENVIADO_CONTABILISTA: 'ABERTO',
};

export default function MonthlyExpenseListScreen() {
  const theme = useTheme();
  const { nif, period } = useLocalSearchParams<{ nif: string; period: string }>();
  const { categories } = useExpenseCategories();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [status, setStatus] = useState<ReportStatus>('ABERTO');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [statusBusy, setStatusBusy] = useState(false);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [filters, setFilters] = useState<ExpenseFilterState>(EMPTY_EXPENSE_FILTERS);
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());

  useFocusEffect(
    useCallback(() => {
      if (!nif || !period) return;
      let cancelled = false;
      setLoading(true);
      setError(null);
      Promise.all([listExpenses({ acquirerNif: nif, period }), listMonthlySummaries(nif)])
        .then(([expenseData, summaries]) => {
          if (cancelled) return;
          setExpenses(expenseData);
          const summary = summaries.find((s) => s.period === period);
          setStatus(summary?.status ?? 'ABERTO');
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Falha ao carregar despesas');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nif, period, reloadToken]),
  );

  const handleToggleStatus = useCallback(async () => {
    if (!nif || !period || statusBusy) return;
    const next = NEXT_STATUS[status];
    setStatusBusy(true);
    try {
      await updateReportStatus(nif, period, next);
      setStatus(next);
    } catch (err) {
      notify('Erro', err instanceof Error ? err.message : 'Falha ao atualizar o estado do mês');
    } finally {
      setStatusBusy(false);
    }
  }, [nif, period, status, statusBusy]);

  const handleDelete = useCallback((expense: Expense) => {
    confirmAction(
      'Eliminar despesa',
      `Eliminar a despesa de ${expense.supplierName || 'fornecedor não indicado'}?`,
      'Eliminar',
      async () => {
        try {
          await deleteExpense(expense.id);
          swipeableRefs.current.delete(expense.id);
          setExpenses((prev) => prev.filter((e) => e.id !== expense.id));
        } catch (err) {
          notify('Erro', err instanceof Error ? err.message : 'Falha ao eliminar despesa');
        }
      },
      () => swipeableRefs.current.get(expense.id)?.close(),
    );
  }, []);

  const filtersActive = hasActiveFilters(filters);
  const filteredExpenses = filtersActive ? applyExpenseFilters(expenses, filters) : expenses;

  return (
    <View style={[styles.container, { backgroundColor: theme.groupedBackground }]}>
      <Stack.Screen
        options={{
          title: period ? formatPeriodLabel(period) : 'Despesas',
          headerRight: () => (
            <View style={styles.headerActions}>
              <Pressable onPress={() => setFiltersVisible((v) => !v)} hitSlop={12}>
                <Ionicons
                  name={filtersActive ? 'filter' : 'filter-outline'}
                  size={22}
                  color={filtersActive ? theme.accent : theme.text}
                />
              </Pressable>
              <Pressable
                onPress={() => router.push({ pathname: '/report-generate', params: { nif, period } })}
                hitSlop={12}
              >
                <Ionicons name="document-attach-outline" size={22} color={theme.accent} />
              </Pressable>
            </View>
          ),
        }}
      />
      <Pressable
        style={[styles.statusPill, { backgroundColor: REPORT_STATUS_COLORS[status] + '22' }]}
        onPress={handleToggleStatus}
        disabled={statusBusy}
      >
        <View style={[styles.statusDot, { backgroundColor: REPORT_STATUS_COLORS[status] }]} />
        <Text style={[styles.statusLabel, { color: REPORT_STATUS_COLORS[status] }]}>
          {REPORT_STATUS_LABELS[status]}
        </Text>
        {statusBusy ? (
          <ActivityIndicator size="small" style={{ marginLeft: 6 }} />
        ) : (
          <Ionicons name="swap-horizontal" size={14} color={REPORT_STATUS_COLORS[status]} style={{ marginLeft: 6 }} />
        )}
      </Pressable>
      {loading && <ActivityIndicator style={styles.spinner} />}
      {error && (
        <View style={styles.errorBox}>
          <Ionicons name="cloud-offline-outline" size={28} color={theme.destructive} />
          <Text style={[styles.error, { color: theme.destructive }]}>{error}</Text>
          <Pressable onPress={() => setReloadToken((v) => v + 1)}>
            <Text style={[styles.retry, { color: theme.accent }]}>Tentar novamente</Text>
          </Pressable>
        </View>
      )}
      {filtersActive && !loading && !error && (
        <Text style={[styles.filterCount, { color: theme.textSecondary }]}>
          {filteredExpenses.length} de {expenses.length} {expenses.length === 1 ? 'fatura' : 'faturas'}
        </Text>
      )}
      <FlatList
        style={styles.list}
        data={filteredExpenses}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListHeaderComponent={
          filtersVisible ? (
            <ExpenseFilterPanel theme={theme} categories={categories} filters={filters} onChange={setFilters} />
          ) : null
        }
        ListEmptyComponent={
          !loading && !error ? (
            <Text style={[styles.empty, { color: theme.textSecondary }]}>
              {filtersActive ? 'Nenhuma fatura corresponde aos filtros.' : 'Sem despesas neste mês.'}
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <ExpenseRow
            theme={theme}
            expense={item}
            categories={categories}
            onDelete={handleDelete}
            swipeableRef={(ref) => {
              if (ref) swipeableRefs.current.set(item.id, ref);
              else swipeableRefs.current.delete(item.id);
            }}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  spinner: { marginTop: 16 },
  errorBox: { alignItems: 'center', gap: 8, marginTop: 60, paddingHorizontal: 24 },
  error: { textAlign: 'center', fontSize: 14 },
  retry: { fontSize: 14, fontWeight: '600', marginTop: 4 },
  empty: { textAlign: 'center', marginTop: 80, fontSize: 15 },
  filterCount: { fontSize: 12.5, marginHorizontal: 16, marginTop: 8 },
  list: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 48 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusLabel: { fontSize: 13, fontWeight: '600' },
});
