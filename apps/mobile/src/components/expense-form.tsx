import type { ReactNode } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CURRENCIES, CURRENCY_LABELS, EXPENSE_TYPES, EXPENSE_TYPE_LABELS, type ExpenseType } from '@invoice-scanner/shared';

import type { useTheme } from '@/hooks/use-theme';
import { EXPENSE_TYPE_ICONS } from '@/constants/expense-type-icons';

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
}) {
  return (
    <View
      style={[
        styles.fieldRow,
        !props.last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: props.theme.separator },
      ]}
    >
      <Text style={[styles.fieldLabel, { color: props.theme.textSecondary }]}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        keyboardType={props.keyboardType ?? 'default'}
        placeholder={props.placeholder}
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
}: {
  theme: Theme;
  value: ExpenseType | null;
  onChange: (type: ExpenseType) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {EXPENSE_TYPES.map((option) => {
        const selected = value === option;
        return (
          <Pressable
            key={option}
            style={[styles.chip, { backgroundColor: selected ? theme.accent : theme.backgroundElement }]}
            onPress={() => onChange(option)}
          >
            <Ionicons name={EXPENSE_TYPE_ICONS[option]} size={15} color={selected ? '#fff' : theme.textSecondary} />
            <Text style={[styles.chipText, { color: selected ? '#fff' : theme.text }]}>
              {EXPENSE_TYPE_LABELS[option]}
            </Text>
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
  fieldLabel: { fontSize: 12.5, marginBottom: 2 },
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
