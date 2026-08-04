import { useCallback, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { Swipeable } from 'react-native-gesture-handler';
import type { ExpenseCategory } from '@invoice-scanner/shared';

import { useTheme } from '@/hooks/use-theme';
import { webMaxWidthStyle } from '@/constants/theme';
import { Card, FieldRow } from '@/components/expense-form';
import { DEFAULT_EXPENSE_TYPE_ICON, EXPENSE_TYPE_ICONS } from '@/constants/expense-type-icons';
import { useAccountVatSettings } from '@/hooks/use-account-vat-settings';
import { confirmAction, notify } from '@/utils/alert';
import { createCategory, deleteCategory, listCategories, updateCategory } from '@/api/client';

type VatChoice = 'none' | 'yes' | 'no';

function vatChoiceFromFlag(flag: boolean | null): VatChoice {
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
  { value: 'none', label: 'Não classificada' },
  { value: 'yes', label: 'Dedutível' },
  { value: 'no', label: 'Não dedutível' },
];

// Categorias de despesa personalizadas por utilizador — cada um tem a sua
// própria lista (semeada a partir das categorias fixas antigas na primeira
// vez), com a flag opcional "IVA dedutível" por categoria. Quando pelo menos
// uma categoria estiver classificada, os relatórios ganham colunas extra com
// a identificação do IVA dedutível (ver report-category-labels.ts no servidor).
export default function CategoriesScreen() {
  const theme = useTheme();
  const { settings: vatSettings } = useAccountVatSettings();
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ExpenseCategory | null>(null); // null = fechado; {id:''} = a criar
  const [formLabel, setFormLabel] = useState('');
  const [formVat, setFormVat] = useState<VatChoice>('none');
  const [saving, setSaving] = useState(false);
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());

  const reload = useCallback(() => {
    setLoading(true);
    listCategories()
      .then(setCategories)
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  function openAdd() {
    setFormLabel('');
    setFormVat('none');
    setEditing({ id: '', key: '', label: '', vatDeductible: null, sortOrder: 0 });
  }

  function openEdit(category: ExpenseCategory) {
    swipeableRefs.current.get(category.id)?.close();
    setFormLabel(category.label);
    setFormVat(vatChoiceFromFlag(category.vatDeductible));
    setEditing(category);
  }

  async function handleSave() {
    const label = formLabel.trim();
    if (!label) {
      notify('Nome em falta', 'Escreve o nome da categoria.');
      return;
    }
    setSaving(true);
    try {
      const vatDeductible = flagFromVatChoice(formVat);
      // As faturas já submetidas guardam a sua própria classificação de IVA
      // dedutível (Expense.vatDeductible) — mudar aqui só passa a valer para
      // faturas novas, nunca retroage. Avisa quando isso é relevante (a
      // categoria já tem faturas e o valor está mesmo a mudar).
      const vatChanged = editing?.id ? vatDeductible !== editing.vatDeductible : false;
      const usageCount = editing?.expenseCount ?? 0;
      if (editing?.id) {
        await updateCategory(editing.id, { label, vatDeductible });
      } else {
        await createCategory({ label, vatDeductible });
      }
      setEditing(null);
      reload();
      if (vatChanged && usageCount > 0) {
        notify(
          'Faturas já submetidas não são alteradas',
          `Esta categoria já tem ${usageCount} despesa(s). A nova classificação de IVA dedutível só se aplica a faturas novas — para mudar as que já estavam guardadas, edita-as uma a uma.`,
        );
      }
    } catch (err) {
      notify('Erro', err instanceof Error ? err.message : 'Falha ao guardar categoria');
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(category: ExpenseCategory) {
    const usageCount = category.expenseCount ?? 0;
    confirmAction(
      'Remover categoria',
      usageCount > 0
        ? `Remover "${category.label}"? Há ${usageCount} despesa(s) com esta categoria — mantêm a classificação já guardada (deixa de aparecer só para faturas novas); para as reclassificar, edita-as uma a uma.`
        : `Remover "${category.label}"? Despesas já registadas com esta categoria mantêm-se, só deixa de aparecer para escolher em faturas novas.`,
      'Remover',
      async () => {
        try {
          await deleteCategory(category.id);
          swipeableRefs.current.delete(category.id);
          setCategories((prev) => prev.filter((c) => c.id !== category.id));
        } catch (err) {
          notify('Erro', err instanceof Error ? err.message : 'Falha ao remover categoria');
        }
      },
      () => swipeableRefs.current.get(category.id)?.close(),
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.groupedBackground }]}>
      <Stack.Screen
        options={{
          title: 'Categorias',
          headerRight: () => (
            <Pressable onPress={openAdd} hitSlop={8}>
              <Ionicons name="add-circle" size={28} color={theme.accent} />
            </Pressable>
          ),
        }}
      />

      <Text style={[styles.intro, { color: theme.textSecondary }, webMaxWidthStyle]}>
        As tuas categorias de despesa — podes renomear, remover, criar novas, e marcar opcionalmente se são IVA
        dedutível. Os relatórios só mostram essa coluna se usares a marcação em pelo menos uma categoria.
      </Text>

      <FlatList
        style={styles.list}
        data={categories}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, webMaxWidthStyle]}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyState}>
              <Ionicons name="pricetag-outline" size={40} color={theme.textSecondary} />
              <Text style={[styles.empty, { color: theme.textSecondary }]}>Ainda não há categorias.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
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
            <Pressable style={[styles.row, { backgroundColor: theme.card }]} onPress={() => openEdit(item)}>
              <View style={[styles.iconWrap, { backgroundColor: theme.backgroundElement }]}>
                <Ionicons
                  name={EXPENSE_TYPE_ICONS[item.key] ?? DEFAULT_EXPENSE_TYPE_ICON}
                  size={20}
                  color={theme.textSecondary}
                />
              </View>
              <View style={styles.rowInfo}>
                <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
                  {item.label}
                </Text>
                <Text style={[styles.rowSubtitle, { color: theme.textSecondary }]}>
                  {item.expenseCount ? `${item.expenseCount} despesa(s)` : 'Sem despesas ainda'}
                  {vatSettings.vatClassificationEnabled
                    ? ` · ${item.vatDeductible === true ? 'IVA dedutível' : item.vatDeductible === false ? 'IVA não dedutível' : 'sem classificação de IVA'}`
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
              {editing?.id ? 'Editar categoria' : 'Nova categoria'}
            </Text>
            <Card theme={theme}>
              <FieldRow theme={theme} label="Nome" value={formLabel} onChangeText={setFormLabel} placeholder="Ex: Restaurantes" last />
            </Card>
            {vatSettings.vatClassificationEnabled && (
              <>
                <Text style={[styles.vatLabel, { color: theme.textSecondary }]}>
                  IVA dedutível (valor por omissão desta categoria)
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
  vatLabel: { fontSize: 12.5, marginTop: 2 },
  vatRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vatChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  vatChipText: { fontSize: 13.5, fontWeight: '600' },
  menuActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  menuCancel: { paddingVertical: 10, paddingHorizontal: 6 },
  menuCancelText: { fontSize: 15.5, fontWeight: '600' },
  saveButton: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 12 },
  saveButtonText: { fontSize: 15.5, fontWeight: '700', color: '#FFFFFF' },
});
