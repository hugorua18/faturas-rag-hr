import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Expense, ExpenseType } from '@invoice-scanner/shared';

import { useTheme } from '@/hooks/use-theme';
import { useSupplierNameAutofill } from '@/hooks/use-supplier-name-autofill';
import { webMaxWidthStyle } from '@/constants/theme';
import { deleteExpense, getExpense, resolveFileUrl, updateExpense } from '@/api/client';
import {
  Card,
  CategoryChipPicker,
  CurrencyChipPicker,
  FieldRow,
  PhotoLightbox,
  SectionHeader,
} from '@/components/expense-form';
import { confirmAction } from '@/utils/alert';
import { parseDecimal } from '@/utils/number';
import { convertToEur } from '@/utils/currency-conversion';

const SOURCE_LABELS: Record<string, string> = {
  CAMERA: 'câmara',
  UPLOAD: 'ficheiro importado',
  EMAIL: 'email',
};

export default function ExpenseDetailScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [expense, setExpense] = useState<Expense | null | undefined>(undefined);
  const [type, setType] = useState<ExpenseType | null>(null);
  const [supplierName, setSupplierName] = useState('');
  const [supplierNif, setSupplierNif] = useState('');
  const [acquirerNif, setAcquirerNif] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [documentDate, setDocumentDate] = useState('');
  const [documentTime, setDocumentTime] = useState('');
  const [amountBase, setAmountBase] = useState('');
  const [amountVat, setAmountVat] = useState('');
  const [amountTotal, setAmountTotal] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [amountTotalEur, setAmountTotalEur] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);

  // Sobretudo útil na revisão de faturas chegadas por email (fila "Tratamento
  // manual"), onde o nome vem quase sempre vazio — preenche a partir do NIF
  // (histórico → VIES) sem sobrepor edições do utilizador.
  useSupplierNameAutofill(supplierNif, supplierName, setSupplierName);

  const loadExpense = useCallback(() => {
    if (!id) return;
    setExpense(undefined);
    getExpense(id)
      .then((data) => {
        setExpense(data);
        setType((data.type as ExpenseType) ?? null);
        setSupplierName(data.supplierName ?? '');
        setSupplierNif(data.supplierNif ?? '');
        setAcquirerNif(data.acquirerNif ?? '');
        setDocumentId(data.documentId ?? '');
        setDocumentDate(data.documentDate ?? '');
        setDocumentTime(data.documentTime ?? '');
        setCurrency(data.currency || 'EUR');
        if (data.currency && data.currency !== 'EUR') {
          // Os campos de valores mostram sempre a moeda original — para uma
          // despesa já convertida, isso é originalAmount*, não amountBase/Vat/Total
          // (que guardam o valor em EUR já calculado).
          setAmountBase(data.originalAmountBase != null ? String(data.originalAmountBase) : '');
          setAmountVat(data.originalAmountVat != null ? String(data.originalAmountVat) : '');
          setAmountTotal(data.originalAmountTotal != null ? String(data.originalAmountTotal) : '');
          setAmountTotalEur(data.amountTotal != null ? String(data.amountTotal) : '');
        } else {
          setAmountBase(data.amountBase != null ? String(data.amountBase) : '');
          setAmountVat(data.amountVat != null ? String(data.amountVat) : '');
          setAmountTotal(data.amountTotal != null ? String(data.amountTotal) : '');
          setAmountTotalEur('');
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Falha ao carregar a despesa');
        setExpense(null);
      });
  }, [id]);

  useEffect(() => {
    loadExpense();
  }, [loadExpense]);

  // Devolve { error } quando a moeda não é válida ou ainda falta o total em
  // Euro para converter — usado para bloquear a gravação nesses casos.
  function fieldUpdates(): { data: ReturnType<typeof buildFieldUpdates> } | { error: string } {
    if (currency !== 'EUR') {
      if (!/^[A-Z]{3}$/.test(currency)) {
        return { error: 'Indica um código de moeda válido (3 letras, ex: JPY).' };
      }
      const conversion = convertToEur(amountBase, amountVat, amountTotal, amountTotalEur);
      if (!conversion) return { error: 'Preenche o total em Euro para converter esta despesa.' };
      return { data: buildFieldUpdates(conversion) };
    }
    return { data: buildFieldUpdates(null) };
  }

  function buildFieldUpdates(conversion: ReturnType<typeof convertToEur>) {
    return {
      type: type ?? undefined,
      supplierName: supplierName || undefined,
      supplierNif: supplierNif || undefined,
      acquirerNif: acquirerNif || undefined,
      documentId: documentId || undefined,
      documentDate: documentDate || undefined,
      documentTime: documentTime || undefined,
      currency,
      amountBase: conversion ? conversion.amountBase : parseDecimal(amountBase),
      amountVat: conversion ? conversion.amountVat : parseDecimal(amountVat),
      amountTotal: conversion ? conversion.amountTotal : parseDecimal(amountTotal),
      originalAmountBase: conversion ? parseDecimal(amountBase) : undefined,
      originalAmountVat: conversion ? parseDecimal(amountVat) : undefined,
      originalAmountTotal: conversion ? parseDecimal(amountTotal) : undefined,
    };
  }

  async function handleSave() {
    if (!id || !type) return;
    const result = fieldUpdates();
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await updateExpense(id, result.data);
      setExpense(updated);
      setSaved(true);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(err instanceof Error ? err.message : 'Falha ao guardar alterações');
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmPending() {
    if (!id || !type) {
      setError('Escolhe o tipo de despesa.');
      return;
    }
    const result = fieldUpdates();
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateExpense(id, { ...result.data, status: 'SUBMETIDA' });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (err) {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(err instanceof Error ? err.message : 'Falha ao confirmar a despesa');
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    if (!id) return;
    const isPending = expense?.status === 'TRATAMENTO_MANUAL';
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    confirmAction(
      isPending ? 'Descartar despesa' : 'Eliminar despesa',
      isPending
        ? 'A despesa e a imagem associada vão ser eliminadas. Queres mesmo descartar?'
        : 'Esta ação não pode ser desfeita. Queres mesmo eliminar esta despesa?',
      isPending ? 'Descartar' : 'Eliminar',
      async () => {
        setDeleting(true);
        setError(null);
        try {
          await deleteExpense(id);
          router.back();
        } catch (err) {
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setError(err instanceof Error ? err.message : 'Falha ao eliminar despesa');
          setDeleting(false);
        }
      },
    );
  }

  if (expense === undefined) {
    return (
      <View style={[styles.center, { backgroundColor: theme.groupedBackground }]}>
        <ActivityIndicator color={theme.textSecondary} />
      </View>
    );
  }

  if (expense === null) {
    return (
      <View style={[styles.center, { backgroundColor: theme.groupedBackground }]}>
        <Ionicons name="alert-circle-outline" size={40} color={theme.textSecondary} />
        <Text style={[styles.centerText, { color: theme.text }]}>{error ?? 'Despesa não encontrada.'}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <Stack.Screen options={{ title: expense.supplierName || 'Despesa' }} />
      <ScrollView
        style={{ backgroundColor: theme.groupedBackground }}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 32 + insets.bottom }, webMaxWidthStyle]}
        keyboardShouldPersistTaps="handled"
      >
        {expense.fileUrl && (
          <Pressable onPress={() => setPreviewVisible(true)}>
            <Image source={{ uri: resolveFileUrl(expense.fileUrl) }} style={styles.preview} resizeMode="cover" />
            <View style={styles.previewBadge}>
              <Ionicons name="expand-outline" size={14} color="#fff" />
            </View>
          </Pressable>
        )}

        {expense.status === 'TRATAMENTO_MANUAL' && (
          <View style={[styles.pendingBanner, { backgroundColor: `${theme.warning}20` }]}>
            <Ionicons name="mail-unread-outline" size={16} color={theme.warning} />
            <Text style={[styles.pendingBannerText, { color: theme.warning }]}>
              Por validar — recebida por {SOURCE_LABELS[expense.source] ?? expense.source}. Confirma os dados abaixo.
            </Text>
          </View>
        )}

        <SectionHeader label="Dados da fatura" theme={theme} />
        <Card theme={theme}>
          <FieldRow theme={theme} label="Nome do prestador" value={supplierName} onChangeText={setSupplierName} placeholder="Ex: Restaurante O Manel" />
          <FieldRow theme={theme} label="NIF do prestador" value={supplierNif} onChangeText={setSupplierNif} keyboardType="numeric" placeholder="123456789" />
          <FieldRow theme={theme} label="NIF do utente" value={acquirerNif} onChangeText={setAcquirerNif} keyboardType="numeric" placeholder="999999990" />
          <FieldRow theme={theme} label="Número do documento" value={documentId} onChangeText={setDocumentId} placeholder="Ex: FT SERIEA/123" />
          <FieldRow theme={theme} label="Data" value={documentDate} onChangeText={setDocumentDate} placeholder="AAAA-MM-DD" />
          <FieldRow theme={theme} label="Hora" value={documentTime} onChangeText={setDocumentTime} placeholder="HH:MM" last />
        </Card>

        <SectionHeader label="Moeda" theme={theme} />
        <CurrencyChipPicker theme={theme} value={currency} onChange={setCurrency} />

        <SectionHeader label="Valores" theme={theme} />
        <Card theme={theme}>
          <FieldRow
            theme={theme}
            label={currency === 'EUR' ? 'Valor sem IVA' : `Valor sem IVA (${currency})`}
            value={amountBase}
            onChangeText={setAmountBase}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
          <FieldRow
            theme={theme}
            label={currency === 'EUR' ? 'Valor do IVA' : `Valor do IVA (${currency})`}
            value={amountVat}
            onChangeText={setAmountVat}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
          <FieldRow
            theme={theme}
            label={currency === 'EUR' ? 'Valor com IVA' : `Valor com IVA (${currency})`}
            value={amountTotal}
            onChangeText={setAmountTotal}
            keyboardType="decimal-pad"
            placeholder="0.00"
            last
          />
        </Card>

        {currency !== 'EUR' && (
          <>
            <SectionHeader label="Conversão para Euro" theme={theme} />
            <Card theme={theme}>
              <FieldRow
                theme={theme}
                label="Total em Euro (€)"
                value={amountTotalEur}
                onChangeText={setAmountTotalEur}
                keyboardType="decimal-pad"
                placeholder="0.00"
                last
              />
            </Card>
            {(() => {
              const preview = convertToEur(amountBase, amountVat, amountTotal, amountTotalEur);
              return preview ? (
                <Text style={[styles.conversionPreview, { color: theme.textSecondary }]}>
                  Em euro: base {preview.amountBase?.toFixed(2) ?? '—'} € · IVA {preview.amountVat?.toFixed(2) ?? '—'} € ·
                  total {preview.amountTotal.toFixed(2)} €
                </Text>
              ) : null;
            })()}
          </>
        )}

        <SectionHeader label="Tipo de despesa" theme={theme} />
        <CategoryChipPicker theme={theme} value={type} onChange={setType} />

        {error && (
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle" size={16} color={theme.destructive} />
            <Text style={[styles.errorText, { color: theme.destructive }]}>{error}</Text>
          </View>
        )}
        {saved && !error && (
          <View style={styles.errorRow}>
            <Ionicons name="checkmark-circle" size={16} color={theme.success} />
            <Text style={[styles.errorText, { color: theme.success }]}>Alterações guardadas.</Text>
          </View>
        )}

        <Pressable
          style={[styles.submitButton, { backgroundColor: theme.accent, opacity: saving ? 0.6 : 1 }]}
          onPress={expense.status === 'TRATAMENTO_MANUAL' ? handleConfirmPending : handleSave}
          disabled={saving || deleting}
        >
          <Text style={styles.submitButtonText}>
            {saving
              ? 'A guardar...'
              : expense.status === 'TRATAMENTO_MANUAL'
                ? 'Confirmar e submeter'
                : 'Guardar alterações'}
          </Text>
        </Pressable>

        <Pressable style={styles.deleteButton} onPress={handleDelete} disabled={saving || deleting}>
          {deleting ? (
            <ActivityIndicator color={theme.destructive} />
          ) : (
            <Text style={[styles.deleteButtonText, { color: theme.destructive }]}>
              {expense.status === 'TRATAMENTO_MANUAL' ? 'Descartar' : 'Eliminar despesa'}
            </Text>
          )}
        </Pressable>
      </ScrollView>

      {expense.fileUrl && (
        <PhotoLightbox
          visible={previewVisible}
          uri={resolveFileUrl(expense.fileUrl)}
          onClose={() => setPreviewVisible(false)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scrollContent: { padding: 16, paddingBottom: 48, gap: 4 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 24 },
  centerText: { textAlign: 'center', fontSize: 16 },
  preview: { width: '100%', height: 200, borderRadius: 14 },
  previewBadge: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12,
    padding: 6,
  },
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    marginTop: 12,
  },
  pendingBannerText: { flex: 1, fontSize: 13, fontWeight: '500' },
  conversionPreview: { fontSize: 13, marginTop: 8, marginLeft: 4 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 },
  errorText: { fontSize: 13.5 },
  submitButton: { marginTop: 28, paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
  submitButtonText: { color: '#fff', fontSize: 16.5, fontWeight: '600' },
  deleteButton: { marginTop: 16, paddingVertical: 14, alignItems: 'center' },
  deleteButtonText: { fontSize: 16, fontWeight: '600' },
});
