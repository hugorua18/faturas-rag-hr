import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Swipeable } from 'react-native-gesture-handler';
import {
  NO_DATE_KEY,
  REPORT_STATUS_COLORS,
  REPORT_STATUS_LABELS,
  type Expense,
  type MonthlySummary,
} from '@invoice-scanner/shared';

import { useTheme } from '@/hooks/use-theme';
import { deleteExpense, listExpenses, listMonthlySummaries } from '@/api/client';
import { useExpenseCategories } from '@/hooks/use-expense-categories';
import { ExpenseRow } from '@/components/expense-row';
import { ExpenseFilterPanel } from '@/components/expense-filter-panel';
import { applyExpenseFilters, EMPTY_EXPENSE_FILTERS, type ExpenseFilterState } from '@/utils/expense-filters';
import { formatCurrency, formatNifLabel, formatPeriodLabel } from '@/utils/format';
import { confirmAction, notify } from '@/utils/alert';

export default function MonthlySummaryListScreen() {
  const theme = useTheme();
  const { nif } = useLocalSearchParams<{ nif: string }>();
  const { categories } = useExpenseCategories();
  const [summaries, setSummaries] = useState<MonthlySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [searchMode, setSearchMode] = useState(false);
  const [fromPeriod, setFromPeriod] = useState('');
  const [toPeriod, setToPeriod] = useState('');
  const [filters, setFilters] = useState<ExpenseFilterState>(EMPTY_EXPENSE_FILTERS);
  const [searchResults, setSearchResults] = useState<Expense[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());

  // Meses reais com faturas, ordenados — usados como opções dos chips
  // "De/Até" da busca. O grupo "sem data" (NO_DATE_KEY) fica de fora: não faz
  // sentido como extremo de um intervalo de datas.
  const realPeriods = summaries
    .map((s) => s.period)
    .filter((p) => p !== NO_DATE_KEY)
    .sort((a, b) => a.localeCompare(b));

  useFocusEffect(
    useCallback(() => {
      if (!nif) return;
      let cancelled = false;
      setLoading(true);
      setError(null);
      listMonthlySummaries(nif)
        .then((data) => {
          if (!cancelled) setSummaries(data);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Falha ao carregar meses');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nif, reloadToken]),
  );

  function openSearch() {
    // Por omissão, procura em todo o intervalo disponível — "período superior
    // a um mês" é precisamente o ponto de partida pedido; o utilizador pode
    // depois estreitar escolhendo outros chips.
    if (realPeriods.length > 0) {
      setFromPeriod(realPeriods[0]);
      setToPeriod(realPeriods[realPeriods.length - 1]);
    }
    setFilters(EMPTY_EXPENSE_FILTERS);
    setSearchMode(true);
  }

  function closeSearch() {
    setSearchMode(false);
    setSearchResults([]);
    setSearchError(null);
  }

  useEffect(() => {
    if (!searchMode || !nif || !fromPeriod || !toPeriod) return;
    let cancelled = false;
    setSearchLoading(true);
    setSearchError(null);
    // Datas ISO comparam-se corretamente como texto — mesmo truque já usado
    // no relatório por intervalo (ver loadRangeReportData no servidor).
    listExpenses({ acquirerNif: nif, from: `${fromPeriod}-01`, to: `${toPeriod}-31` })
      .then((data) => {
        if (!cancelled) setSearchResults(data);
      })
      .catch((err) => {
        if (!cancelled) setSearchError(err instanceof Error ? err.message : 'Falha ao procurar faturas');
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [searchMode, nif, fromPeriod, toPeriod]);

  const handleDelete = useCallback((expense: Expense) => {
    confirmAction(
      'Eliminar despesa',
      `Eliminar a despesa de ${expense.supplierName || 'fornecedor não indicado'}?`,
      'Eliminar',
      async () => {
        try {
          await deleteExpense(expense.id);
          swipeableRefs.current.delete(expense.id);
          setSearchResults((prev) => prev.filter((e) => e.id !== expense.id));
          // A busca só mexe em "searchResults" — sem isto, o contador/total do
          // mês (visível ao fechar a busca) ficava desatualizado até um
          // verdadeiro evento de foco voltar a correr o useFocusEffect acima.
          setReloadToken((v) => v + 1);
        } catch (err) {
          notify('Erro', err instanceof Error ? err.message : 'Falha ao eliminar despesa');
        }
      },
      () => swipeableRefs.current.get(expense.id)?.close(),
    );
  }, []);

  const filteredResults = applyExpenseFilters(searchResults, filters);

  return (
    <View style={[styles.container, { backgroundColor: theme.groupedBackground }]}>
      <Stack.Screen
        options={{
          title: nif ? formatNifLabel(nif) : 'Meses',
          headerRight: () => (
            <View style={styles.headerActions}>
              {!searchMode && (
                <Pressable onPress={openSearch} hitSlop={12}>
                  <Ionicons name="search-outline" size={22} color={theme.text} />
                </Pressable>
              )}
              <Pressable onPress={() => router.push({ pathname: '/report-generate', params: { nif } })} hitSlop={12}>
                <Ionicons name="document-attach-outline" size={22} color={theme.accent} />
              </Pressable>
            </View>
          ),
        }}
      />

      {searchMode ? (
        <>
          <View style={styles.searchHeader}>
            <Text style={[styles.searchTitle, { color: theme.text }]}>Buscar faturas</Text>
            <Pressable onPress={closeSearch} hitSlop={8}>
              <Ionicons name="close-circle" size={24} color={theme.textSecondary} />
            </Pressable>
          </View>

          <FlatList
            style={styles.list}
            data={filteredResults}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            ListHeaderComponent={
              <View style={{ gap: 4 }}>
                {realPeriods.length > 0 && (
                  <>
                    <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>DE</Text>
                    <View style={styles.chipRow}>
                      {realPeriods.map((p) => {
                        const selected = fromPeriod === p;
                        return (
                          <Pressable
                            key={p}
                            style={[styles.chip, { backgroundColor: selected ? theme.accent : theme.backgroundElement }]}
                            onPress={() => setFromPeriod(p)}
                          >
                            <Text style={[styles.chipText, { color: selected ? '#fff' : theme.text }]}>
                              {formatPeriodLabel(p)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>ATÉ</Text>
                    <View style={styles.chipRow}>
                      {realPeriods.map((p) => {
                        const selected = toPeriod === p;
                        return (
                          <Pressable
                            key={p}
                            style={[styles.chip, { backgroundColor: selected ? theme.accent : theme.backgroundElement }]}
                            onPress={() => setToPeriod(p)}
                          >
                            <Text style={[styles.chipText, { color: selected ? '#fff' : theme.text }]}>
                              {formatPeriodLabel(p)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                )}

                <ExpenseFilterPanel
                  theme={theme}
                  categories={categories}
                  filters={filters}
                  onChange={setFilters}
                  showDateFields={false}
                />

                {searchLoading && <ActivityIndicator style={styles.spinner} />}
                {searchError && (
                  <Text style={[styles.error, { color: theme.destructive }]}>{searchError}</Text>
                )}
                {!searchLoading && !searchError && (
                  <Text style={[styles.filterCount, { color: theme.textSecondary }]}>
                    {filteredResults.length} de {searchResults.length}{' '}
                    {searchResults.length === 1 ? 'fatura' : 'faturas'} · {formatPeriodLabel(fromPeriod)} –{' '}
                    {formatPeriodLabel(toPeriod)}
                  </Text>
                )}
              </View>
            }
            ListEmptyComponent={
              !searchLoading && !searchError ? (
                <Text style={[styles.empty, { color: theme.textSecondary }]}>Nenhuma fatura encontrada.</Text>
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
        </>
      ) : (
        <>
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
            data={summaries}
            keyExtractor={(item) => item.period}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            ListEmptyComponent={
              !loading && !error ? (
                <Text style={[styles.empty, { color: theme.textSecondary }]}>Sem meses para este NIF.</Text>
              ) : null
            }
            renderItem={({ item }) => (
              <Pressable
                style={[styles.row, { backgroundColor: theme.card }]}
                onPress={() => router.push(`/expenses/${nif}/${item.period}`)}
              >
                <View style={[styles.iconWrap, { backgroundColor: theme.backgroundElement }]}>
                  <Ionicons name="calendar-outline" size={20} color={theme.textSecondary} />
                </View>
                <View style={styles.rowInfo}>
                  <Text style={[styles.rowTitle, { color: theme.text }]}>{formatPeriodLabel(item.period)}</Text>
                  <View style={styles.rowSubtitleLine}>
                    <View style={[styles.statusDot, { backgroundColor: REPORT_STATUS_COLORS[item.status] }]} />
                    <Text style={[styles.rowSubtitle, { color: theme.textSecondary }]}>
                      {item.documentCount} {item.documentCount === 1 ? 'documento' : 'documentos'} ·{' '}
                      {REPORT_STATUS_LABELS[item.status]}
                    </Text>
                  </View>
                </View>
                <View style={styles.rowTrailing}>
                  <Text style={[styles.rowAmount, { color: theme.text }]}>{formatCurrency(item.totalAmount)}</Text>
                  <Ionicons name="chevron-forward" size={16} color={theme.separator} />
                </View>
              </Pressable>
            )}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  searchTitle: { fontSize: 15.5, fontWeight: '600' },
  spinner: { marginTop: 16 },
  errorBox: { alignItems: 'center', gap: 8, marginTop: 60, paddingHorizontal: 24 },
  error: { textAlign: 'center', fontSize: 14 },
  retry: { fontSize: 14, fontWeight: '600', marginTop: 4 },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 15 },
  filterCount: { fontSize: 12.5, marginTop: 12, marginLeft: 4 },
  sectionLabel: { fontSize: 12, fontWeight: '600', marginTop: 16, marginBottom: 6, marginLeft: 4, letterSpacing: 0.4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, minHeight: 40, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 13.5, fontWeight: '500' },
  list: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14 },
  iconWrap: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1, gap: 2, justifyContent: 'center' },
  rowTitle: { fontSize: 15.5, fontWeight: '600' },
  rowSubtitleLine: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  rowSubtitle: { fontSize: 13 },
  rowTrailing: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowAmount: { fontSize: 15, fontWeight: '600' },
});
