// Nativo (iOS/Android). Web tem o irmão date-field.web.tsx — o Metro resolve
// automaticamente o ficheiro certo por plataforma a partir do mesmo import.
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import type { useTheme } from '@/hooks/use-theme';
import { formatDateLabel, parseIsoDate, toIsoDateString } from '@/utils/date';

type Theme = ReturnType<typeof useTheme>;

export function DateField(props: {
  theme: Theme;
  label: string;
  value: string;
  onChange: (value: string) => void;
  last?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <View
      style={[
        styles.fieldRow,
        !props.last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: props.theme.separator },
      ]}
    >
      <Text style={[styles.fieldLabel, { color: props.theme.textSecondary }]}>{props.label}</Text>
      <Pressable onPress={() => setOpen(true)} hitSlop={6}>
        <Text style={[styles.fieldValue, { color: props.value ? props.theme.text : props.theme.textSecondary }]}>
          {props.value ? formatDateLabel(props.value) : 'Selecionar data'}
        </Text>
      </Pressable>
      {open && (
        <DateTimePicker
          value={parseIsoDate(props.value) ?? new Date()}
          mode="date"
          // 'inline' mostra logo a grelha do calendário ao tocar (é o que foi
          // pedido). O Android do pacote não suporta 'inline'/'compact' — a
          // app não tem build Android ativo, mas o recuo para 'default'
          // mantém isto funcional se algum dia vier a ter.
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(_event, selectedDate) => {
            // Fecha em qualquer evento (selecionada ou cancelada) — 'onDismiss'
            // só existe no tipo de props de alguns dos displays (a união
            // discriminada do pacote não o inclui quando 'display' é
            // dinâmico), por isso fecha-se sempre aqui.
            setOpen(false);
            if (selectedDate) props.onChange(toIsoDateString(selectedDate));
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fieldRow: { paddingHorizontal: 14, paddingVertical: 10 },
  fieldLabel: { fontSize: 12.5, marginBottom: 2 },
  fieldValue: { fontSize: 16.5, paddingVertical: 2 },
});
