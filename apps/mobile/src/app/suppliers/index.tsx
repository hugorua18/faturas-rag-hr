import { useCallback, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { Swipeable } from 'react-native-gesture-handler';
import { EXPENSE_TYPE_LABELS, isExpenseType } from '@invoice-scanner/shared';

import { useTheme } from '@/hooks/use-theme';
import { webMaxWidthStyle } from '@/constants/theme';
import { Card, CategoryChipPicker, FieldRow } from '@/components/expense-form';
import { confirmAction, notify } from '@/utils/alert';
import { useExpenseCategories } from '@/hooks/use-expense-categories';
import { useAccountVatSettings } from '@/hooks/use-account-vat-settings';
import { useSupplierVatDefaults } from '@/hooks/use-supplier-vat-defaults';
import { useSupplierCategoryDefaults } from '@/hooks/use-supplier-category-defaults';
import { setSupplierCategoryDefault, setSupplierVatDefault } from '@/api/client';
import {
  listCachedSuppliers,
  removeCachedSupplier,
  setCachedSupplierName,
  type CachedSupplier,
} from '@/state/supplier-cache';

type VatChoice = 'none' | 'yes' | 'no';

function vatChoiceFromFlag(flag: boolean | undefined): VatChoice {
  if (flag === true) return 'yes';
  if (flag === false) return 'no';
  return 'none';
}

function flagFromVatChoice(choice: VatChoice): boolean | null {
  if (choice === 'yes') return true;
  if (choice === 'no') return false;
  return null;
}

const VAT_CHOICES: { value: VatChoice; label: string }[] = [
  { value: 'none', label: 'Sem valor por omissão' },
  { value: 'yes', label: 'Dedutível' },
  { value: 'no', label: 'Não dedutível' },
];

// Gestão do cache local (só neste dispositivo) de nome de prestador por NIF —
// usado para preencher automaticamente o campo "Nome do prestador" na
// validação de faturas sem depender do servidor. Ver use-supplier-name-autofill.
export default function SuppliersScreen() {
  const theme = useTheme();
  const { categories } = useExpenseCategories();
  const { settings: vatSettings } = useAccountVatSettings();
  const { defaults: supplierVatDefaults, reload: reloadVatDefaults } = useSupplierVatDefaults();
  const { defaults: supplierCategoryDefaults, reload: reloadCategoryDefaults } = useSupplierCategoryDefaults();
  const showVatDefault = vatSettings.vatClassificationEnabled && vatSettings.vatAutoFillMode === 'SUPPLIER';
  const [suppliers, setSuppliers] = useState<CachedSupplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CachedSupplier | null>(null); // null = fechado; {nif:'', name:''} = a criar
  const [formNif, setFormNif] = useState('');
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<string | null>(null);
  const [formVat, setFormVat] = useState<VatChoice>('none');
  const [saving, setSaving] = useState(false);
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());

  const reload = useCallback(() => {
    setLoading(true);
    listCachedSuppliers()
      .then(setSuppliers)
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  function openAdd() {
    setFormNif('');
    setFormName('');
    setFormCategory(null);
    setFormVat('none');
    setEditing({ nif: '', name: '' });
  }

  function openEdit(supplier: CachedSupplier) {
    swipeableRefs.current.get(supplier.nif)?.close();
    setFormNif(supplier.nif);
    setFormName(supplier.name);
    setFormCategory(supplierCategoryDefaults[supplier.nif] ?? null);
    setFormVat(vatChoiceFromFlag(supplierVatDefaults[supplier.nif]));
    setEditing(supplier);
  }

  async function handleSave() {
    const nif = formNif.trim();
    const name = formName.trim();
    if (!/^\d{9}$/.test(nif)) {
      notify('NIF inválido', 'O NIF deve ter 9 dígitos.');
      return;
    }
    if (!name) {
      notify('Nome em falta', 'Escreve o nome a associar a este NIF.');
      return;
    }
    setSaving(true);
    try {
      // Editar o NIF de uma entrada existente é, na prática, criar uma nova
      // entrada e remover a antiga — a chave do cache é o próprio NIF.
      const nifChanged = Boolean(editing?.nif) && editing!.nif !== nif;
      if (nifChanged) {
        await removeCachedSupplier(editing!.nif);
      }
      await setCachedSupplierName(nif, name);
      if (nifChanged) await setSupplierCategoryDefault(editing!.nif, null);
      await setSupplierCategoryDefault(nif, formCategory);
      reloadCategoryDefaults();
      if (showVatDefault) {
        if (nifChanged) await setSupplierVatDefault(editing!.nif, null);
        await setSupplierVatDefault(nif, flagFromVatChoice(formVat));
        reloadVatDefaults();
      }
      setEditing(null);
      reload();
    } catch (err) {
      notify('Erro', err instanceof Error ? err.message : 'Falha ao guardar fornecedor');
    } finally {
      setSaving(false);
    }
  }

  // Remove o nome do cache local e as omissões (categoria/IVA) guardadas no
  // servidor para este NIF — nunca toca em despesas já submetidas, só deixa
  // de haver preenchimento automático para as próximas.
  async function performDelete(supplier: CachedSupplier) {
    await removeCachedSupplier(supplier.nif);
    await Promise.all([
      setSupplierCategoryDefault(supplier.nif, null).catch((err) =>
        console.error('[suppliers] falha ao limpar categoria por omissão', err),
      ),
      setSupplierVatDefault(supplier.nif, null).catch((err) =>
        console.error('[suppliers] falha ao limpar IVA por omissão', err),
      ),
    ]);
    reloadCategoryDefaults();
    reloadVatDefaults();
  }

  // Alcance via gesto de deslizar (nativo) — em rato/trackpad (Web) o gesto
  // nem sempre é óbvio ou fiável, por isso há também um botão equivalente
  // dentro do modal de edição (handleDeleteFromModal).
  function handleDelete(supplier: CachedSupplier) {
    confirmAction(
      'Remover fornecedor',
      `Remover "${supplier.name}" do preenchimento automático? Isto não afeta despesas já registadas.`,
      'Remover',
      async () => {
        await performDelete(supplier);
        swipeableRefs.current.delete(supplier.nif);
        setSuppliers((prev) => prev.filter((s) => s.nif !== supplier.nif));
      },
      () => swipeableRefs.current.get(supplier.nif)?.close(),
    );
  }

  function handleDeleteFromModal() {
    if (!editing?.nif) return;
    const supplier = editing;
    confirmAction(
      'Remover fornecedor',
      `Remover "${supplier.name}" do preenchimento automático? Isto não afeta despesas já registadas.`,
      'Remover',
      async () => {
        await performDelete(supplier);
        setEditing(null);
        reload();
      },
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.groupedBackground }]}>
      <Stack.Screen
        options={{
          title: 'Fornecedores',
          headerRight: () => (
            <Pressable onPress={openAdd} hitSlop={8}>
              <Ionicons name="add-circle" size={28} color={theme.accent} />
            </Pressable>
          ),
        }}
      />

      <Text style={[styles.intro, { color: theme.textSecondary }, webMaxWidthStyle]}>
        Nomes guardados neste dispositivo para preencher o &quot;Nome do prestador&quot; automaticamente. A categoria
        por omissão sincroniza entre dispositivos e pré-preenche o tipo de despesa — continua sempre alterável em
        cada fatura.
      </Text>

      <FlatList
        style={styles.list}
        data={suppliers}
        keyExtractor={(item) => item.nif}
        contentContainerStyle={[styles.listContent, webMaxWidthStyle]}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyState}>
              <Ionicons name="business-outline" size={40} color={theme.textSecondary} />
              <Text style={[styles.empty, { color: theme.textSecondary }]}>
                Ainda não há fornecedores guardados neste dispositivo.
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Swipeable
            ref={(ref) => {
              if (ref) swipeableRefs.current.set(item.nif, ref);
              else swipeableRefs.current.delete(item.nif);
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
            <Pressable style={[styles.row, { backgroundColor: theme.card }]} onPress={() => openEdit(item)}>
              <View style={[styles.iconWrap, { backgroundColor: theme.backgroundElement }]}>
                <Ionicons name="business-outline" size={20} color={theme.textSecondary} />
              </View>
              <View style={styles.rowInfo}>
                <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.rowSubtitle, { color: theme.textSecondary }]}>
                  NIF {item.nif}
                  {(() => {
                    const categoryKey = supplierCategoryDefaults[item.nif] ?? item.lastType;
                    if (!categoryKey) return '';
                    const label =
                      categories.find((c) => c.key === categoryKey)?.label ??
                      (isExpenseType(categoryKey) ? EXPENSE_TYPE_LABELS[categoryKey] : categoryKey);
                    return ` · ${label}`;
                  })()}
                  {showVatDefault
                    ? ` · ${
                        supplierVatDefaults[item.nif] === true
                          ? 'IVA dedutível'
                          : supplierVatDefaults[item.nif] === false
                            ? 'IVA não dedutível'
                            : 'sem valor de IVA por omissão'
                      }`
                    : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.separator} />
            </Pressable>
          </Swipeable>
        )}
      />

      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <Pressable style={styles.menuOverlay} onPress={() => setEditing(null)}>
          <Pressable
            style={[styles.menuCard, { backgroundColor: theme.groupedBackground }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.menuTitle, { color: theme.text }]}>
              {editing?.nif ? 'Editar fornecedor' : 'Novo fornecedor'}
            </Text>
            <Card theme={theme}>
              <FieldRow
                theme={theme}
                label="NIF"
                value={formNif}
                onChangeText={(text) => setFormNif(text.replace(/\D/g, '').slice(0, 9))}
                keyboardType="numeric"
                placeholder="123456789"
              />
              <FieldRow theme={theme} label="Nome" value={formName} onChangeText={setFormName} placeholder="Ex: Restaurante O Manel" last />
            </Card>
            <View style={styles.categoryLabelRow}>
              <Text style={[styles.vatLabel, { color: theme.textSecondary }]}>
                Categoria (pré-preenchimento nas faturas — sempre alterável)
              </Text>
              {formCategory && (
                <Pressable onPress={() => setFormCategory(null)} hitSlop={8}>
                  <Text style={[styles.clearCategoryText, { color: theme.accent }]}>Remover</Text>
                </Pressable>
              )}
            </View>
            <CategoryChipPicker theme={theme} value={formCategory} onChange={setFormCategory} categories={categories} />
            {showVatDefault && (
              <>
                <Text style={[styles.vatLabel, { color: theme.textSecondary }]}>
                  IVA dedutível (valor por omissão deste fornecedor)
                </Text>
                <View style={styles.vatRow}>
                  {VAT_CHOICES.map((choice) => {
                    const selected = formVat === choice.value;
                    return (
                      <Pressable
                        key={choice.value}
                        style={[styles.vatChip, { backgroundColor: selected ? theme.accent : theme.backgroundElement }]}
                        onPress={() => setFormVat(choice.value)}
                      >
                        <Text style={[styles.vatChipText, { color: selected ? '#fff' : theme.text }]}>{choice.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}
            <View style={styles.menuActions}>
              <Pressable style={styles.menuCancel} onPress={() => setEditing(null)} disabled={saving}>
                <Text style={[styles.menuCancelText, { color: theme.accent }]}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={[styles.saveButton, { backgroundColor: theme.accent }, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                <Text style={styles.saveButtonText}>{saving ? 'A guardar…' : 'Guardar'}</Text>
              </Pressable>
            </View>
            {editing?.nif && (
              <Pressable style={styles.deleteButton} onPress={handleDeleteFromModal} disabled={saving}>
                <Text style={[styles.deleteButtonText, { color: theme.destructive }]}>Eliminar fornecedor</Text>
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      </Modal>
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
  iconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1, gap: 2, justifyContent: 'center' },
  rowTitle: { fontSize: 15.5, fontWeight: '600' },
  rowSubtitle: { fontSize: 13 },
  vatLabel: { fontSize: 12.5, marginTop: 2 },
  vatRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  clearCategoryText: { fontSize: 12.5, fontWeight: '600' },
  vatChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  vatChipText: { fontSize: 13.5, fontWeight: '600' },
  deleteAction: {
    width: 72,
    marginLeft: 8,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  menuCard: { width: '100%', maxWidth: 360, borderRadius: 16, padding: 16, gap: 12 },
  menuTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 2 },
  menuActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  menuCancel: { paddingVertical: 10, paddingHorizontal: 6 },
  menuCancelText: { fontSize: 15.5, fontWeight: '600' },
  saveButton: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 12 },
  saveButtonText: { fontSize: 15.5, fontWeight: '700', color: '#FFFFFF' },
  deleteButton: { marginTop: 4, paddingVertical: 10, alignItems: 'center' },
  deleteButtonText: { fontSize: 14.5, fontWeight: '600' },
});
