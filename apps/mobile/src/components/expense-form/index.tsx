import type { ReactNode } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CURRENCIES, CURRENCY_LABELS, type ExpenseCategory } from '@invoice-scanner/shared';

import type { useTheme } from '@/hooks/use-theme';
import { DEFAULT_EXPENSE_TYPE_ICON, EXPENSE_TYPE_ICONS } from '@/constants/expense-type-icons';

export { DateField } from './date-field';

type Theme = ReturnType<typeof useTheme>;

export function SectionHeader({ label, theme }: { label: string; theme: Theme }) {
  return <Text style={[styles.sectionHeader, { color: theme.textSecondary }]}>{label.toUpperCase()}</Text>;
}

export function Card({ theme, children }: { theme: Theme; children: ReactNode }) {
  return <View style={[styles.card, { backgroundColor: theme.card }]}>{children}</View>;
}

export function FieldRow(props: {
  theme: Theme;
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  last?: boolean;
  // Consulta em curso a preencher este campo automaticamente (ex: nome do
  // prestador a partir do NIF) — mostra um indicador junto ao rótulo em vez
  // de deixar o campo simplesmente vazio e parado, o que parece um bug
  // quando a consulta demora (ex: servidor gratuito "a acordar").
  loading?: boolean;
}) {
  return (
    <View
      style={[
        styles.fieldRow,
        !props.last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: props.theme.separator },
      ]}
    >
      <View style={styles.fieldLabelRow}>
        <Text style={[styles.fieldLabel, { color: props.theme.textSecondary }]}>{props.label}</Text>
        {props.loading ? <ActivityIndicator size="small" color={props.theme.textSecondary} /> : null}
      </View>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        keyboardType={props.keyboardType ?? 'default'}
        placeholder={props.loading ? 'A procurar nome…' : props.placeholder}
        placeholderTextColor={props.theme.textSecondary}
        style={[styles.fieldInput, { color: props.theme.text }]}
      />
    </View>
  );
}

export function CategoryChipPicker({
  theme,
  value,
  onChange,
  categories,
}: {
  theme: Theme;
  value: string | null;
  onChange: (key: string) => void;
  categories: ExpenseCategory[];
}) {
  return (
    <View style={styles.chipRow}>
      {categories.map((option) => {
        const selected = value === option.key;
        return (
          <Pressable
            key={option.key}
            style={[styles.chip, { backgroundColor: selected ? theme.accent : theme.backgroundElement }]}
            onPress={() => onChange(option.key)}
          >
            <Ionicons
              name={EXPENSE_TYPE_ICONS[option.key] ?? DEFAULT_EXPENSE_TYPE_ICON}
              size={15}
              color={selected ? '#fff' : theme.textSecondary}
            />
            <Text style={[styles.chipText, { color: selected ? '#fff' : theme.text }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Sim/Não obrigatório quando AccountVatSettings.vatClassificationEnabled está
// ativo (ver validation.tsx / expense/[id].tsx) — sem opção "não classificada"
// à vista porque, uma vez ativa a flag, a app exige sempre uma escolha.
export function VatDeductibleChipPicker({
  theme,
  value,
  onChange,
}: {
  theme: Theme;
  value: boolean | null;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {(
        [
          { value: true, label: 'Sim' },
          { value: false, label: 'Não' },
        ] as const
      ).map((option) => {
        const selected = value === option.value;
        return (
          <Pressable
            key={String(option.value)}
            style={[styles.chip, { backgroundColor: selected ? theme.accent : theme.backgroundElement }]}
            onPress={() => onChange(option.value)}
          >
            <Text style={[styles.chipText, { color: selected ? '#fff' : theme.text }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function CurrencyChipPicker({
  theme,
  value,
  onChange,
}: {
  theme: Theme;
  value: string;
  onChange: (currency: string) => void;
}) {
  const isPreset = (CURRENCIES as readonly string[]).includes(value);
  return (
    <View>
      <View style={styles.chipRow}>
        {CURRENCIES.map((option) => {
          const selected = value === option;
          return (
            <Pressable
              key={option}
              style={[styles.chip, { backgroundColor: selected ? theme.accent : theme.backgroundElement }]}
              onPress={() => onChange(option)}
            >
              <Text style={[styles.chipText, { color: selected ? '#fff' : theme.text }]}>
                {CURRENCY_LABELS[option]}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          style={[styles.chip, { backgroundColor: !isPreset ? theme.accent : theme.backgroundElement }]}
          onPress={() => {
            if (isPreset) onChange('');
          }}
        >
          <Text style={[styles.chipText, { color: !isPreset ? '#fff' : theme.text }]}>Outra</Text>
        </Pressable>
      </View>
      {!isPreset && (
        <View style={{ marginTop: 10 }}>
          <Card theme={theme}>
            <FieldRow
              theme={theme}
              label="Código da moeda (ex: JPY)"
              value={value}
              onChangeText={(text) => onChange(text.toUpperCase().slice(0, 3))}
              placeholder="XXX"
              last
            />
          </Card>
        </View>
      )}
    </View>
  );
}

export function PhotoLightbox({ visible, uri, onClose }: { visible: boolean; uri: string; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.lightbox}>
        <Pressable style={styles.lightboxClose} onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        <Image source={{ uri }} style={styles.lightboxImage} resizeMode="contain" />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { fontSize: 12, fontWeight: '600', marginTop: 20, marginBottom: 6, marginLeft: 4, letterSpacing: 0.4 },
  card: { borderRadius: 12, overflow: 'hidden' },
  fieldRow: { paddingHorizontal: 14, paddingVertical: 10 },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  fieldLabel: { fontSize: 12.5 },
  fieldInput: { fontSize: 16.5, paddingVertical: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
    minHeight: 44,
    borderRadius: 18,
  },
  chipText: { fontSize: 13.5, fontWeight: '500' },
  lightbox: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  lightboxImage: { width: '100%', height: '80%' },
  lightboxClose: {
    position: 'absolute',
    top: 56,
    right: 20,
    zIndex: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20,
    padding: 8,
  },
});
