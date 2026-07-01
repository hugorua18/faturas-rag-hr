import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect } from 'expo-router';
import type { AcquirerNifSummary } from '@invoice-scanner/shared';

import { useTheme } from '@/hooks/use-theme';
import { listAcquirerNifSummaries } from '@/api/client';
import { formatCurrency, formatNifLabel } from '@/utils/format';

export default function AcquirerNifListScreen() {
  const theme = useTheme();
  const [summaries, setSummaries] = useState<AcquirerNifSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      setError(null);
      listAcquirerNifSummaries()
        .then((data) => {
          if (!cancelled) setSummaries(data);
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
    }, [reloadToken]),
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.groupedBackground }]}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => router.push('/')} hitSlop={12}>
              <Ionicons name="add-circle" size={28} color={theme.accent} />
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
        keyExtractor={(item) => item.acquirerNif}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          !loading && !error ? (
            <View style={styles.emptyState}>
              <Ionicons name="receipt-outline" size={40} color={theme.textSecondary} />
              <Text style={[styles.empty, { color: theme.textSecondary }]}>Ainda não há despesas submetidas.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            style={[styles.row, { backgroundColor: theme.card }]}
            onPress={() => router.push(`/expenses/${item.acquirerNif}`)}
          >
            <View style={[styles.iconWrap, { backgroundColor: theme.backgroundElement }]}>
              <Ionicons name="business-outline" size={20} color={theme.textSecondary} />
            </View>
            <View style={styles.rowInfo}>
              <Text style={[styles.rowTitle, { color: theme.text }]}>{formatNifLabel(item.acquirerNif)}</Text>
              <Text style={[styles.rowSubtitle, { color: theme.textSecondary }]}>
                {item.documentCount} {item.documentCount === 1 ? 'documento' : 'documentos'}
              </Text>
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
  emptyState: { alignItems: 'center', gap: 10, marginTop: 80 },
  empty: { fontSize: 15 },
  // FlatList precisa de `style={flex:1}` explícito para reservar espaço no
  // layout nativo (Yoga) — sem isto, colapsa para altura zero e a lista
  // parece "desaparecer" mesmo com dados (só na Web é que passava, porque o
  // motor de layout do browser é mais tolerante).
  list: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14 },
  iconWrap: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1, gap: 2, justifyContent: 'center' },
  rowTitle: { fontSize: 15.5, fontWeight: '600' },
  rowSubtitle: { fontSize: 13 },
  rowTrailing: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowAmount: { fontSize: 15, fontWeight: '600' },
});
