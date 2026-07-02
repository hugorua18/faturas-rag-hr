import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { EXPENSE_TYPE_LABELS, type Expense, type ExpenseType } from '@invoice-scanner/shared';

import { useTheme } from '@/hooks/use-theme';
import { listExpenses, resolveFileUrl } from '@/api/client';
import { EXPENSE_TYPE_ICONS } from '@/constants/expense-type-icons';
import { formatCurrency } from '@/utils/format';

const SOURCE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  EMAIL: 'mail-outline',
  UPLOAD: 'document-attach-outline',
  CAMERA: 'camera-outline',
};

export default function PendingReviewListScreen() {
  const theme = useTheme();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      setError(null);
      listExpenses({ status: 'TRATAMENTO_MANUAL' })
        .then((data) => {
          if (!cancelled) setExpenses(data);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Falha ao carregar despesas pendentes');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [reloadToken]),
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.groupedBackground }]}>
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
            <View style={styles.emptyState}>
              <Ionicons name="checkmark-done-outline" size={40} color={theme.textSecondary} />
              <Text style={[styles.empty, { color: theme.textSecondary }]}>Nada por validar de momento.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const type = item.type as ExpenseType;
          return (
            <Pressable
              style={[styles.row, { backgroundColor: theme.card }]}
              onPress={() => router.push(`/expense/${item.id}`)}
            >
              {item.fileUrl ? (
                <Image source={{ uri: resolveFileUrl(item.fileUrl) }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder, { backgroundColor: theme.backgroundElement }]}>
                  <Ionicons name={EXPENSE_TYPE_ICONS[type] ?? 'document-outline'} size={20} color={theme.textSecondary} />
                </View>
              )}
              <View style={styles.rowInfo}>
                <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
                  {item.supplierName || 'Fornecedor não indicado'}
                </Text>
                <View style={styles.rowSubtitleLine}>
                  <Ionicons name={SOURCE_ICONS[item.source] ?? 'document-outline'} size={12} color={theme.textSecondary} />
                  <Text style={[styles.rowSubtitle, { color: theme.textSecondary }]}>
                    {' '}
                    {EXPENSE_TYPE_LABELS[type] ?? item.type} · {item.documentDate || 'sem data'}
                  </Text>
                </View>
              </View>
              <View style={styles.rowTrailing}>
                <Text style={[styles.rowAmount, { color: theme.text }]}>
                  {item.amountTotal !== undefined && item.amountTotal !== null ? formatCurrency(item.amountTotal) : '—'}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={theme.separator} />
              </View>
            </Pressable>
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
  emptyState: { alignItems: 'center', gap: 10, marginTop: 80 },
  empty: { fontSize: 15 },
  list: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14 },
  thumb: { width: 48, height: 48, borderRadius: 10 },
  thumbPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  rowInfo: { flex: 1, gap: 2, justifyContent: 'center' },
  rowTitle: { fontSize: 15.5, fontWeight: '600' },
  rowSubtitleLine: { flexDirection: 'row', alignItems: 'center' },
  rowSubtitle: { fontSize: 13 },
  rowTrailing: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowAmount: { fontSize: 15, fontWeight: '600' },
});
