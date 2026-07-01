import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Swipeable } from 'react-native-gesture-handler';
import {
  EXPENSE_TYPE_LABELS,
  REPORT_STATUS_COLORS,
  REPORT_STATUS_LABELS,
  type Expense,
  type ExpenseType,
  type ReportStatus,
} from '@invoice-scanner/shared';

import { useTheme } from '@/hooks/use-theme';
import { deleteExpense, listExpenses, listMonthlySummaries, resolveFileUrl, updateReportStatus } from '@/api/client';
import { EXPENSE_TYPE_ICONS } from '@/constants/expense-type-icons';
import { formatCurrency, formatPeriodLabel } from '@/utils/format';
import { confirmAction, notify } from '@/utils/alert';

const NEXT_STATUS: Record<ReportStatus, ReportStatus> = {
  ABERTO: 'ENVIADO_CONTABILISTA',
  ENVIADO_CONTABILISTA: 'ABERTO',
};

export default function MonthlyExpenseListScreen() {
  const theme = useTheme();
  const { nif, period } = useLocalSearchParams<{ nif: string; period: string }>();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [status, setStatus] = useState<ReportStatus>('ABERTO');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [statusBusy, setStatusBusy] = useState(false);
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

  return (
    <View style={[styles.container, { backgroundColor: theme.groupedBackground }]}>
      <Stack.Screen
        options={{
          title: period ? formatPeriodLabel(period) : 'Despesas',
          headerRight: () => (
            <Pressable
              onPress={() => router.push({ pathname: '/report-generate', params: { nif, period } })}
              hitSlop={12}
            >
              <Ionicons name="document-attach-outline" size={22} color={theme.accent} />
            </Pressable>
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
      <FlatList
        style={styles.list}
        data={expenses}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          !loading && !error ? (
            <Text style={[styles.empty, { color: theme.textSecondary }]}>Sem despesas neste mês.</Text>
          ) : null
        }
        renderItem={({ item }) => {
          const type = item.type as ExpenseType;
          return (
            <Swipeable
              ref={(ref) => {
                if (ref) swipeableRefs.current.set(item.id, ref);
                else swipeableRefs.current.delete(item.id);
              }}
              renderRightActions={() => (
                <Pressable
                  style={[styles.deleteAction, { backgroundColor: theme.destructive }]}
                  onPress={() => handleDelete(item)}
                >
                  <Ionicons name="trash-outline" size={22} color="#FFFFFF" />
                </Pressable>
              )}
            >
              <Pressable
                style={[styles.row, { backgroundColor: theme.card }]}
                onPress={() => router.push(`/expense/${item.id}`)}
              >
                {item.originalFilePath ? (
                  <Image source={{ uri: resolveFileUrl(item.originalFilePath) }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, styles.thumbPlaceholder, { backgroundColor: theme.backgroundElement }]}>
                    <Ionicons name={EXPENSE_TYPE_ICONS[type] ?? 'document-outline'} size={20} color={theme.textSecondary} />
                  </View>
                )}
                <View style={styles.rowInfo}>
                  <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
                    {item.supplierName || 'Fornecedor não indicado'}
                  </Text>
                  <Text style={[styles.rowSubtitle, { color: theme.textSecondary }]}>
                    {EXPENSE_TYPE_LABELS[type] ?? item.type} · {item.documentDate || 'sem data'}
                  </Text>
                </View>
                <View style={styles.rowTrailing}>
                  <Text style={[styles.rowAmount, { color: theme.text }]}>{formatCurrency(item.amountTotal)}</Text>
                  <Ionicons name="chevron-forward" size={16} color={theme.separator} />
                </View>
              </Pressable>
            </Swipeable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  spinner: { marginTop: 16 },
  errorBox: { alignItems: 'center', gap: 8, marginTop: 60, paddingHorizontal: 24 },
  error: { textAlign: 'center', fontSize: 14 },
  retry: { fontSize: 14, fontWeight: '600', marginTop: 4 },
  empty: { textAlign: 'center', marginTop: 80, fontSize: 15 },
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
