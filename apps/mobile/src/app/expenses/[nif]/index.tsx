import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { REPORT_STATUS_COLORS, REPORT_STATUS_LABELS, type MonthlySummary } from '@invoice-scanner/shared';

import { useTheme } from '@/hooks/use-theme';
import { listMonthlySummaries } from '@/api/client';
import { formatCurrency, formatNifLabel, formatPeriodLabel } from '@/utils/format';

export default function MonthlySummaryListScreen() {
  const theme = useTheme();
  const { nif } = useLocalSearchParams<{ nif: string }>();
  const [summaries, setSummaries] = useState<MonthlySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

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

  return (
    <View style={[styles.container, { backgroundColor: theme.groupedBackground }]}>
      <Stack.Screen
        options={{
          title: nif ? formatNifLabel(nif) : 'Meses',
          headerRight: () => (
            <Pressable onPress={() => router.push({ pathname: '/report-generate', params: { nif } })} hitSlop={12}>
              <Ionicons name="document-attach-outline" size={22} color={theme.accent} />
            </Pressable>
          ),
        }}
      />
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
