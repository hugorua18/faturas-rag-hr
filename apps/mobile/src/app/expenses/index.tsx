import { useCallback, useState, type ComponentProps } from 'react';
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect } from 'expo-router';
import type { AcquirerNifSummary } from '@invoice-scanner/shared';

import { useTheme } from '@/hooks/use-theme';
import { usePendingCount } from '@/hooks/use-pending-count';
import { useEmailFeatureAvailable } from '@/hooks/use-email-feature';
import {
  listAcquirerNifSummaries,
  listAcquirerNifDisplays,
  setAcquirerNifDisplay,
  type AcquirerNifDisplay,
} from '@/api/client';
import { formatCurrency, formatNifLabel } from '@/utils/format';
import { pickAndImportDocument, pickAndImportFromGallery } from '@/utils/import-document';
import { PendingCountBadge } from '@/components/pending-count-badge';
import { Card, FieldRow } from '@/components/expense-form';
import { AccountMenuModal } from '@/components/account-menu-modal';
import { ACQUIRER_NIF_ICON_CHOICES, DEFAULT_ACQUIRER_NIF_ICON } from '@/constants/acquirer-nif-icons';
import { useSupplierBackfill } from '@/hooks/use-supplier-backfill';
import { notify } from '@/utils/alert';

export default function AcquirerNifListScreen() {
  const theme = useTheme();
  const pendingCount = usePendingCount();
  const emailFeatureAvailable = useEmailFeatureAvailable();
  const [summaries, setSummaries] = useState<AcquirerNifSummary[]>([]);
  const [displays, setDisplays] = useState<Record<string, AcquirerNifDisplay>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [importingSource, setImportingSource] = useState<'file' | 'gallery' | null>(null);
  const importing = importingSource !== null;
  const [editingNif, setEditingNif] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState('');
  const [iconInput, setIconInput] = useState<string>(DEFAULT_ACQUIRER_NIF_ICON);
  const [savingLabel, setSavingLabel] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  function openLabelEditor(nif: string) {
    setLabelInput(displays[nif]?.label ?? '');
    setIconInput(displays[nif]?.icon ?? DEFAULT_ACQUIRER_NIF_ICON);
    setEditingNif(nif);
  }

  async function handleSaveLabel() {
    if (!editingNif) return;
    setSavingLabel(true);
    try {
      const display: AcquirerNifDisplay = {
        label: labelInput.trim() || undefined,
        icon: iconInput !== DEFAULT_ACQUIRER_NIF_ICON ? iconInput : undefined,
      };
      await setAcquirerNifDisplay(editingNif, display);
      setDisplays((prev) => {
        const next = { ...prev };
        if (display.label || display.icon) next[editingNif] = display;
        else delete next[editingNif];
        return next;
      });
      setEditingNif(null);
    } catch (err) {
      notify('Erro', err instanceof Error ? err.message : 'Falha ao guardar etiqueta do NIF');
    } finally {
      setSavingLabel(false);
    }
  }

  function handleAdd() {
    if (Platform.OS === 'web') {
      // Na Web este ecrã é a "casa" — o "+" pergunta se é ficheiro ou foto.
      setAddMenuOpen(true);
    } else {
      // No iOS/Android a câmara é o ecrã inicial — o "+" volta lá.
      router.push('/');
    }
  }

  async function runImport(source: 'file' | 'gallery', importer: () => Promise<boolean>) {
    if (importing) return;
    setImportingSource(source);
    try {
      const navigated = await importer();
      if (navigated) setAddMenuOpen(false);
    } finally {
      setImportingSource(null);
    }
  }

  function handleImportFile() {
    void runImport('file', pickAndImportDocument);
  }

  function handleImportFromGallery() {
    void runImport('gallery', pickAndImportFromGallery);
  }

  function handleTakePhoto() {
    setAddMenuOpen(false);
    // /?camera=1 fura o redirect Web→/expenses do index e abre mesmo a câmara.
    router.push({ pathname: '/', params: { camera: '1' } });
  }

  useSupplierBackfill();

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
      void listAcquirerNifDisplays()
        .then((data) => {
          if (!cancelled) setDisplays(data);
        })
        .catch(() => {
          // Etiquetas/ícones são só uma conveniência — falha silenciosa, a lista de NIFs continua a funcionar.
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
              {emailFeatureAvailable && (
                <Pressable onPress={() => router.push('/pending')} hitSlop={8}>
                  <Ionicons name="mail-unread-outline" size={24} color={theme.accent} />
                  <PendingCountBadge count={pendingCount} />
                </Pressable>
              )}
              <Pressable onPress={handleAdd} hitSlop={8}>
                <Ionicons name="add-circle" size={28} color={theme.accent} />
              </Pressable>
              <Pressable onPress={() => setAccountMenuOpen(true)} hitSlop={8}>
                <Ionicons name="person-circle-outline" size={26} color={theme.accent} />
              </Pressable>
            </View>
          ),
        }}
      />

      <AccountMenuModal visible={accountMenuOpen} onClose={() => setAccountMenuOpen(false)} theme={theme} />

      <Modal visible={addMenuOpen} transparent animationType="fade" onRequestClose={() => setAddMenuOpen(false)}>
        <Pressable style={styles.menuOverlay} onPress={() => setAddMenuOpen(false)}>
          <Pressable style={[styles.menuCard, { backgroundColor: theme.card }]} onPress={() => {}}>
            <Text style={[styles.menuTitle, { color: theme.text }]}>Adicionar fatura</Text>
            <Pressable
              style={[styles.menuOption, { backgroundColor: theme.backgroundElement }]}
              onPress={handleImportFile}
              disabled={importing}
            >
              {importingSource === 'file' ? (
                <ActivityIndicator color={theme.accent} />
              ) : (
                <Ionicons name="document-attach-outline" size={20} color={theme.accent} />
              )}
              <Text style={[styles.menuOptionText, { color: theme.text }]}>
                {importingSource === 'file' ? 'A processar…' : 'Adicionar ficheiro'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.menuOption, { backgroundColor: theme.backgroundElement }]}
              onPress={handleImportFromGallery}
              disabled={importing}
            >
              {importingSource === 'gallery' ? (
                <ActivityIndicator color={theme.accent} />
              ) : (
                <Ionicons name="images-outline" size={20} color={theme.accent} />
              )}
              <Text style={[styles.menuOptionText, { color: theme.text }]}>
                {importingSource === 'gallery' ? 'A processar…' : 'Escolher da fototeca'}
              </Text>
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
        renderItem={({ item }) => {
          const display = displays[item.acquirerNif];
          const label = display?.label;
          return (
            <Pressable
              style={[styles.row, { backgroundColor: theme.card }]}
              onPress={() => router.push(`/expenses/${item.acquirerNif}`)}
            >
              <View style={[styles.iconWrap, { backgroundColor: theme.backgroundElement }]}>
                <Ionicons
                  name={(display?.icon ?? DEFAULT_ACQUIRER_NIF_ICON) as ComponentProps<typeof Ionicons>['name']}
                  size={20}
                  color={theme.textSecondary}
                />
              </View>
              <View style={styles.rowInfo}>
                <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
                  {label || formatNifLabel(item.acquirerNif)}
                </Text>
                <Text style={[styles.rowSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
                  {label ? `${formatNifLabel(item.acquirerNif)} · ` : ''}
                  {item.documentCount} {item.documentCount === 1 ? 'documento' : 'documentos'}
                </Text>
              </View>
              <Pressable
                style={styles.editButton}
                hitSlop={8}
                onPress={(e) => {
                  e.stopPropagation();
                  openLabelEditor(item.acquirerNif);
                }}
              >
                <Ionicons name="pencil-outline" size={16} color={theme.textSecondary} />
              </Pressable>
              <View style={styles.rowTrailing}>
                <Text style={[styles.rowAmount, { color: theme.text }]}>{formatCurrency(item.totalAmount)}</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.separator} />
              </View>
            </Pressable>
          );
        }}
      />

      <Modal visible={editingNif !== null} transparent animationType="fade" onRequestClose={() => setEditingNif(null)}>
        <Pressable style={styles.menuOverlay} onPress={() => setEditingNif(null)}>
          <Pressable
            style={[styles.menuCard, { backgroundColor: theme.groupedBackground }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.menuTitle, { color: theme.text }]}>Etiqueta do NIF</Text>
            <Card theme={theme}>
              <FieldRow
                theme={theme}
                label="Nome"
                value={labelInput}
                onChangeText={setLabelInput}
                placeholder={editingNif ? formatNifLabel(editingNif) : ''}
                last
              />
            </Card>
            <Text style={[styles.iconLabel, { color: theme.textSecondary }]}>Ícone</Text>
            <View style={styles.iconRow}>
              {ACQUIRER_NIF_ICON_CHOICES.map((choice) => {
                const selected = iconInput === choice;
                return (
                  <Pressable
                    key={choice}
                    style={[styles.iconChip, { backgroundColor: selected ? theme.accent : theme.backgroundElement }]}
                    onPress={() => setIconInput(choice)}
                  >
                    <Ionicons name={choice} size={18} color={selected ? '#fff' : theme.textSecondary} />
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.menuActions}>
              <Pressable style={styles.menuCancel} onPress={() => setEditingNif(null)} disabled={savingLabel}>
                <Text style={[styles.menuCancelText, { color: theme.accent }]}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={[styles.saveButton, { backgroundColor: theme.accent }, savingLabel && { opacity: 0.6 }]}
                onPress={handleSaveLabel}
                disabled={savingLabel}
              >
                <Text style={styles.saveButtonText}>{savingLabel ? 'A guardar…' : 'Guardar'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  editButton: { padding: 6, marginRight: 2 },
  rowTrailing: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowAmount: { fontSize: 15, fontWeight: '600' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  iconLabel: { fontSize: 12.5, marginTop: 2 },
  iconRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  iconChip: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  menuActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  saveButton: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 12 },
  saveButtonText: { fontSize: 15.5, fontWeight: '700', color: '#FFFFFF' },
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
