import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect } from 'expo-router';
import type { AcquirerNifSummary } from '@invoice-scanner/shared';

import { useTheme } from '@/hooks/use-theme';
import { usePendingCount } from '@/hooks/use-pending-count';
import { listAcquirerNifSummaries, logout } from '@/api/client';
import { formatCurrency, formatNifLabel } from '@/utils/format';
import { pickAndImportDocument, pickAndImportFromGallery } from '@/utils/import-document';
import { confirmAction } from '@/utils/alert';
import { PendingCountBadge } from '@/components/pending-count-badge';

export default function AcquirerNifListScreen() {
  const theme = useTheme();
  const pendingCount = usePendingCount();
  const [summaries, setSummaries] = useState<AcquirerNifSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  function handleAdd() {
    if (Platform.OS === 'web') {
      // Na Web este ecrã é a "casa" — o "+" pergunta se é ficheiro ou foto.
      setAddMenuOpen(true);
    } else {
      // No iOS/Android a câmara é o ecrã inicial — o "+" volta lá.
      router.push('/');
    }
  }

  async function runImport(importer: () => Promise<boolean>) {
    if (importing) return;
    setImporting(true);
    try {
      const navigated = await importer();
      if (navigated) setAddMenuOpen(false);
    } finally {
      setImporting(false);
    }
  }

  function handleImportFile() {
    void runImport(pickAndImportDocument);
  }

  function handleImportFromGallery() {
    void runImport(pickAndImportFromGallery);
  }

  function handleTakePhoto() {
    setAddMenuOpen(false);
    // /?camera=1 fura o redirect Web→/expenses do index e abre mesmo a câmara.
    router.push({ pathname: '/', params: { camera: '1' } });
  }

  function handleLogout() {
    confirmAction('Terminar sessão', 'Tens a certeza que queres sair da tua conta?', 'Terminar sessão', () => {
      logout();
    });
  }

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
            <View style={styles.headerActions}>
              <Pressable onPress={() => router.push('/pending')} hitSlop={8}>
                <Ionicons name="mail-unread-outline" size={24} color={theme.accent} />
                <PendingCountBadge count={pendingCount} />
              </Pressable>
              <Pressable onPress={handleAdd} hitSlop={8}>
                <Ionicons name="add-circle" size={28} color={theme.accent} />
              </Pressable>
              <Pressable onPress={handleLogout} hitSlop={8}>
                <Ionicons name="log-out-outline" size={24} color={theme.accent} />
              </Pressable>
            </View>
          ),
        }}
      />

      <Modal visible={addMenuOpen} transparent animationType="fade" onRequestClose={() => setAddMenuOpen(false)}>
        <Pressable style={styles.menuOverlay} onPress={() => setAddMenuOpen(false)}>
          <Pressable style={[styles.menuCard, { backgroundColor: theme.card }]} onPress={() => {}}>
            <Text style={[styles.menuTitle, { color: theme.text }]}>Adicionar fatura</Text>
            <Pressable
              style={[styles.menuOption, { backgroundColor: theme.backgroundElement }]}
              onPress={handleImportFile}
              disabled={importing}
            >
              {importing ? (
                <ActivityIndicator color={theme.accent} />
              ) : (
                <Ionicons name="document-attach-outline" size={20} color={theme.accent} />
              )}
              <Text style={[styles.menuOptionText, { color: theme.text }]}>
                {importing ? 'A processar…' : 'Adicionar ficheiro'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.menuOption, { backgroundColor: theme.backgroundElement }]}
              onPress={handleImportFromGallery}
              disabled={importing}
            >
              <Ionicons name="images-outline" size={20} color={theme.accent} />
              <Text style={[styles.menuOptionText, { color: theme.text }]}>Escolher da fototeca</Text>
            </Pressable>
            <Pressable
              style={[styles.menuOption, { backgroundColor: theme.backgroundElement }]}
              onPress={handleTakePhoto}
              disabled={importing}
            >
              <Ionicons name="camera-outline" size={20} color={theme.accent} />
              <Text style={[styles.menuOptionText, { color: theme.text }]}>Tirar foto</Text>
            </Pressable>
            <Pressable style={styles.menuCancel} onPress={() => setAddMenuOpen(false)} disabled={importing}>
              <Text style={[styles.menuCancelText, { color: theme.accent }]}>Cancelar</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  menuCard: { width: '100%', maxWidth: 360, borderRadius: 16, padding: 16, gap: 10 },
  menuTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
  menuOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  menuOptionText: { fontSize: 15.5, fontWeight: '500' },
  menuCancel: { alignItems: 'center', paddingVertical: 10 },
  menuCancelText: { fontSize: 15.5, fontWeight: '600' },
});
