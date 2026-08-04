import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';
import { useAccountVatSettings } from '@/hooks/use-account-vat-settings';
import { webMaxWidthStyle } from '@/constants/theme';
import { Card } from '@/components/expense-form';
import { updateAccountVatSettings } from '@/api/client';
import { notify } from '@/utils/alert';

type Theme = ReturnType<typeof useTheme>;
type AutoFillChoice = 'NONE' | 'SUPPLIER' | 'CATEGORY';

const AUTO_FILL_CHOICES: { value: AutoFillChoice; label: string; hint: string }[] = [
  { value: 'NONE', label: 'Não preencher automaticamente', hint: 'Escolhes sempre à mão, fatura a fatura.' },
  { value: 'SUPPLIER', label: 'Por fornecedor', hint: 'Usa a última classificação guardada para o NIF do prestador.' },
  { value: 'CATEGORY', label: 'Por categoria', hint: 'Usa a classificação guardada na categoria da despesa.' },
];

// Definições de conta para a classificação de IVA dedutível — desativada por
// omissão (ver AccountVatSettings em @invoice-scanner/shared). Quando ativa,
// o preenchimento automático é opcional e mutuamente exclusivo (fornecedor OU
// categoria, nunca os dois): um único campo nullable no servidor garante isso
// por construção, não é preciso validação extra aqui.
export default function VatSettingsScreen() {
  const theme = useTheme();
  const { settings, loading, reload } = useAccountVatSettings();
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<AutoFillChoice>('NONE');
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loading || initialized) return;
    setEnabled(settings.vatClassificationEnabled);
    setMode(settings.vatAutoFillMode ?? 'NONE');
    setInitialized(true);
  }, [loading, initialized, settings]);

  async function persist(nextEnabled: boolean, nextMode: AutoFillChoice) {
    setSaving(true);
    try {
      await updateAccountVatSettings({
        vatClassificationEnabled: nextEnabled,
        vatAutoFillMode: nextMode === 'NONE' ? null : nextMode,
      });
    } catch (err) {
      notify('Erro', err instanceof Error ? err.message : 'Falha ao guardar as definições de IVA');
      reload();
    } finally {
      setSaving(false);
    }
  }

  function handleToggle(next: boolean) {
    setEnabled(next);
    void persist(next, mode);
  }

  function handleModeSelect(next: AutoFillChoice) {
    setMode(next);
    void persist(enabled, next);
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.groupedBackground }]}>
      <Stack.Screen options={{ title: 'IVA dedutível', headerBackTitle: 'Voltar' }} />

      <Text style={[styles.intro, { color: theme.textSecondary }, webMaxWidthStyle]}>
        Quando ativa, cada fatura passa a exigir a classificação de IVA dedutível e os relatórios ganham uma coluna
        extra com essa informação.
      </Text>

      <View style={[styles.content, webMaxWidthStyle]}>
        <Card theme={theme}>
          <View style={styles.toggleRow}>
            <Text style={[styles.toggleLabel, { color: theme.text }]}>Classificar IVA dedutível</Text>
            <Switch value={enabled} onValueChange={handleToggle} disabled={saving || !initialized} />
          </View>
        </Card>

        {enabled && (
          <>
            <Text style={[styles.sectionHeader, { color: theme.textSecondary }]}>PREENCHIMENTO AUTOMÁTICO</Text>
            <Card theme={theme}>
              {AUTO_FILL_CHOICES.map((choice, index) => (
                <ChoiceRow
                  key={choice.value}
                  theme={theme}
                  label={choice.label}
                  hint={choice.hint}
                  selected={mode === choice.value}
                  last={index === AUTO_FILL_CHOICES.length - 1}
                  disabled={saving}
                  onPress={() => handleModeSelect(choice.value)}
                />
              ))}
            </Card>
          </>
        )}
      </View>
    </View>
  );
}

function ChoiceRow({
  theme,
  label,
  hint,
  selected,
  last,
  disabled,
  onPress,
}: {
  theme: Theme;
  label: string;
  hint: string;
  selected: boolean;
  last?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[
        styles.choiceRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.separator },
      ]}
      disabled={disabled}
      onPress={onPress}
    >
      <View style={styles.choiceTextWrap}>
        <Text style={[styles.choiceLabel, { color: theme.text }]}>{label}</Text>
        <Text style={[styles.choiceHint, { color: theme.textSecondary }]}>{hint}</Text>
      </View>
      <View
        style={[
          styles.radioOuter,
          { borderColor: selected ? theme.accent : theme.separator },
          selected && { backgroundColor: theme.accent },
        ]}
      >
        {selected && <View style={styles.radioInner} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  intro: { fontSize: 13, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, alignSelf: 'center', width: '100%' },
  content: { padding: 16, gap: 4, alignSelf: 'center', width: '100%' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  toggleLabel: { fontSize: 16, fontWeight: '500' },
  sectionHeader: { fontSize: 12, fontWeight: '600', marginTop: 20, marginBottom: 6, marginLeft: 4, letterSpacing: 0.4 },
  choiceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  choiceTextWrap: { flex: 1, gap: 2 },
  choiceLabel: { fontSize: 15.5, fontWeight: '500' },
  choiceHint: { fontSize: 12.5 },
  radioOuter: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioInner: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: '#fff' },
});
