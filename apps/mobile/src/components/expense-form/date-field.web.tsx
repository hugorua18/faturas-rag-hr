// Web. @react-native-community/datetimepicker não suporta a plataforma web
// (só iOS/Android) — <input type="date"> dá o calendário nativo do browser
// sem dependências extra. createElement (não JSX) porque os tipos do React
// Native não reconhecem elementos DOM como 'input' no JSX.IntrinsicElements;
// este ficheiro só entra no bundle Web (o Metro escolhe .web.tsx nessa
// plataforma), por isso não há risco de o nativo tentar renderizar isto.
import { createElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Theme = ReturnType<typeof useTheme>;

export function DateField(props: {
  theme: Theme;
  label: string;
  value: string;
  onChange: (value: string) => void;
  last?: boolean;
}) {
  const scheme = useColorScheme();

  return (
    <View
      style={[
        styles.fieldRow,
        !props.last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: props.theme.separator },
      ]}
    >
      <Text style={[styles.fieldLabel, { color: props.theme.textSecondary }]}>{props.label}</Text>
      {createElement('input', {
        type: 'date',
        value: props.value,
        onChange: (event: { target: { value: string } }) => props.onChange(event.target.value),
        style: {
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontFamily: 'inherit',
          fontSize: 16.5,
          color: props.theme.text,
          colorScheme: scheme === 'dark' ? 'dark' : 'light',
          paddingTop: 2,
          paddingBottom: 2,
          width: '100%',
        },
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fieldRow: { paddingHorizontal: 14, paddingVertical: 10 },
  fieldLabel: { fontSize: 12.5, marginBottom: 2 },
});
