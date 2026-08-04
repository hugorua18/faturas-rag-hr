import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ExpenseCategory } from '@invoice-scanner/shared';

import type { useTheme } from '@/hooks/use-theme';
import { Card, DateField, FieldRow } from '@/components/expense-form';
import { EMPTY_EXPENSE_FILTERS, type ExpenseFilterState } from '@/utils/expense-filters';

type Theme = ReturnType<typeof useTheme>;

// Painel de filtros partilhado entre a listagem de um mês
// (expenses/[nif]/[period].tsx) e a busca entre meses (expenses/[nif]/index.tsx)
// — o ecrã que o usa decide quando o mostrar/esconder; isto só renderiza o
// conteúdo. Categorias são seleção múltipla (nenhuma selecionada = todas).
export function ExpenseFilterPanel({
  theme,
  categories,
  filters,
  onChange,
  showDateFields = true,
}: {
  theme: Theme;
  categories: ExpenseCategory[];
  filters: ExpenseFilterState;
  onChange: (next: ExpenseFilterState) => void;
  /** Desliga-se na busca entre meses (expenses/[nif]/index.tsx) — aí o
   * intervalo já é escolhido pelos chips de mês "De/Até", e mostrar também
   * datas aqui seriam dois controlos de intervalo a competir. */
  showDateFields?: boolean;
}) {
  function toggleCategory(key: string) {
    const next = filters.categoryKeys.includes(key)
      ? filters.categoryKeys.filter((k) => k !== key)
      : [...filters.categoryKeys, key];
    onChange({ ...filters, categoryKeys: next });
  }

  return (
    <View style={styles.container}>
      <Card theme={theme}>
        <FieldRow
          theme={theme}
          label="Fornecedor"
          value={filters.supplierQuery}
          onChangeText={(text) => onChange({ ...filters, supplierQuery: text })}
          placeholder="Nome ou NIF"
        />
        {showDateFields && (
          <>
            <DateField
              theme={theme}
              label="Data de"
              value={filters.dateFrom}
              onChange={(value) => onChange({ ...filters, dateFrom: value })}
            />
            <DateField
              theme={theme}
              label="Data até"
              value={filters.dateTo}
              onChange={(value) => onChange({ ...filters, dateTo: value })}
            />
          </>
        )}
        <FieldRow
          theme={theme}
          label="Valor mínimo (€)"
          value={filters.amountMin}
          onChangeText={(text) => onChange({ ...filters, amountMin: text })}
          keyboardType="decimal-pad"
          placeholder="0.00"
        />
        <FieldRow
          theme={theme}
          label="Valor máximo (€)"
          value={filters.amountMax}
          onChangeText={(text) => onChange({ ...filters, amountMax: text })}
          keyboardType="decimal-pad"
          placeholder="0.00"
          last
        />
      </Card>

      {categories.length > 0 && (
        <>
          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>CATEGORIAS</Text>
          <View style={styles.chipRow}>
            {categories.map((category) => {
              const selected = filters.categoryKeys.includes(category.key);
              return (
                <Pressable
                  key={category.key}
                  style={[styles.chip, { backgroundColor: selected ? theme.accent : theme.backgroundElement }]}
                  onPress={() => toggleCategory(category.key)}
                >
                  <Text style={[styles.chipText, { color: selected ? '#fff' : theme.text }]}>{category.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      <Pressable style={styles.clearRow} onPress={() => onChange(EMPTY_EXPENSE_FILTERS)} hitSlop={8}>
        <Ionicons name="close-circle-outline" size={16} color={theme.accent} />
        <Text style={[styles.clearText, { color: theme.accent }]}>Limpar filtros</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 4 },
  sectionLabel: { fontSize: 12, fontWeight: '600', marginTop: 16, marginBottom: 6, marginLeft: 4, letterSpacing: 0.4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, minHeight: 40, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 13.5, fontWeight: '500' },
  clearRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, alignSelf: 'center' },
  clearText: { fontSize: 14, fontWeight: '600' },
});
