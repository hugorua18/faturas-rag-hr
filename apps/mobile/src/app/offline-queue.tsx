import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { Swipeable } from 'react-native-gesture-handler';
import { EXPENSE_TYPE_LABELS, isExpenseType } from '@invoice-scanner/shared';

import { useTheme } from '@/hooks/use-theme';
import { useExpenseCategories } from '@/hooks/use-expense-categories';
import { useOfflineQueueSync } from '@/hooks/use-offline-queue-sync';
import { webMaxWidthStyle } from '@/constants/theme';
import { DEFAULT_EXPENSE_TYPE_ICON, EXPENSE_TYPE_ICONS } from '@/constants/expense-type-icons';
import { listQueuedSubmissions, removeQueuedSubmission, type QueuedSubmission } from '@/state/offline-queue';
import { confirmAction } from '@/utils/alert';
import { formatCurrency } from '@/utils/format';

// Faturas submetidas sem ligação à internet e ainda à espera de reenvio (ver
// state/offline-queue.ts + hooks/use-offline-queue-sync.ts). Reenviam-se
// sozinhas assim que a ligação voltar — este ecrã só serve para conferir o
// que está por enviar, forçar uma tentativa manual (puxar para atualizar) ou
// descartar uma submissão que já não faz sentido.
export default function OfflineQueueScreen() {
  const theme = useTheme();
  const { categories } = useExpenseCategories();
  const { syncing, syncNow } = useOfflineQueueSync();
  const [items, setItems] = useState<QueuedSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());

  const reload = useCallback(() => {
    setLoading(true);
    listQueuedSubmissions()
      .then(setItems)
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  // Depois de um reenvio (automático ou puxado manualmente) terminar, a lista
  // pode ter mudado — atualiza assim que "syncing" volta a false.
  useEffect(() => {
    if (!syncing) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncing]);

  function handleDiscard(item: QueuedSubmission) {
    confirmAction(
      'Descartar fatura',
      'A fatura e os dados preenchidos são apagados do telemóvel e deixam de ser submetidos automaticamente.',
      'Descartar',
      async () => {
        await removeQueuedSubmission(item.id);
        setItems((prev) => prev.filter((i) => i.id !== item.id));
      },
      () => swipeableRefs.current.get(item.id)?.close(),
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.groupedBackground }]}>
      <Stack.Screen options={{ title: 'Por enviar', headerBackTitle: 'Voltar' }} />

      <Text style={[styles.intro, { color: theme.textSecondary }, webMaxWidthStyle]}>
        Faturas submetidas sem ligação à internet — são enviadas automaticamente assim que o telemóvel voltar a ter
        rede. Podes puxar para baixo para tentar já.
      </Text>

      <FlatList
        style={styles.list}
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, webMaxWidthStyle]}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => void syncNow()} tintColor={theme.textSecondary} />}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyState}>
              <Ionicons name="checkmark-done-outline" size={40} color={theme.textSecondary} />
              <Text style={[styles.empty, { color: theme.textSecondary }]}>Nada por enviar de momento.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const categoryLabel =
            categories.find((c) => c.key === item.input.type)?.label ??
            (isExpenseType(item.input.type) ? EXPENSE_TYPE_LABELS[item.input.type] : item.input.type);
          const isImage = item.fileMimeType.startsWith('image/');
          return (
            <Swipeable
              ref={(ref) => {
                if (ref) swipeableRefs.current.set(item.id, ref);
                else swipeableRefs.current.delete(item.id);
              }}
              renderRightActions={() => (
                <Pressable
                  style={[styles.deleteAction, { backgroundColor: theme.destructive }]}
                  onPress={() => handleDiscard(item)}
                >
                  <Ionicons name="trash-outline" size={22} color="#FFFFFF" />
                </Pressable>
              )}
            >
              <View style={[styles.row, { backgroundColor: theme.card }]}>
                {isImage ? (
                  <Image source={{ uri: item.fileUri }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, styles.thumbPlaceholder, { backgroundColor: theme.backgroundElement }]}>
                    <Ionicons
                      name={EXPENSE_TYPE_ICONS[item.input.type] ?? DEFAULT_EXPENSE_TYPE_ICON}
                      size={20}
                      color={theme.textSecondary}
                    />
                  </View>
                )}
                <View style={styles.rowInfo}>
                  <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
                    {item.input.supplierName || 'Fornecedor não indicado'}
                  </Text>
                  <Text style={[styles.rowSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
                    {categoryLabel} · {item.input.documentDate || 'sem data'}
                  </Text>
                  {item.lastError && (
                    <View style={styles.errorRow}>
                      <Ionicons name="alert-circle-outline" size={12} color={theme.destructive} />
                      <Text style={[styles.errorText, { color: theme.destructive }]} numberOfLines={2}>
                        {item.lastError}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.rowAmount, { color: theme.text }]}>{formatCurrency(item.input.amountTotal)}</Text>
              </View>
            </Swipeable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  intro: { fontSize: 13, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, alignSelf: 'center', width: '100%' },
  list: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 48, alignSelf: 'center', width: '100%' },
  emptyState: { alignItems: 'center', gap: 10, marginTop: 60 },
  empty: { fontSize: 15, textAlign: 'center', paddingHorizontal: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14 },
  thumb: { width: 48, height: 48, borderRadius: 10 },
  thumbPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  rowInfo: { flex: 1, gap: 2, justifyContent: 'center' },
  rowTitle: { fontSize: 15.5, fontWeight: '600' },
  rowSubtitle: { fontSize: 13 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  errorText: { fontSize: 11.5, flex: 1 },
  rowAmount: { fontSize: 15, fontWeight: '600' },
  deleteAction: {
    width: 72,
    marginLeft: 8,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
