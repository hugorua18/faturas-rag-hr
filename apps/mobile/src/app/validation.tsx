import { useEffect, useState } from 'react';
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
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  amountsAreConsistent,
  hasAllAmounts,
  nifsAreDistinct,
  type ExpenseType,
  type ExpenseInput,
} from '@invoice-scanner/shared';

import { useTheme } from '@/hooks/use-theme';
import { useSupplierNameAutofill } from '@/hooks/use-supplier-name-autofill';
import { webMaxWidthStyle } from '@/constants/theme';
import { createExpense, DuplicateExpenseError, extractDocument } from '@/api/client';
import { takePendingCapture, type PendingCapture } from '@/state/pending-capture';
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

export default function ValidationScreen() {
  const theme = useTheme();
  const [capture, setCapture] = useState<PendingCapture | null | undefined>(undefined);
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
  const [submitting, setSubmitting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);

  // O QR das faturas PT traz o NIF do prestador mas nunca o nome — tenta
  // preenchê-lo automaticamente (histórico → VIES) sem sobrepor o que o
  // utilizador escrever.
  useSupplierNameAutofill(supplierNif, supplierName, setSupplierName);

  // Preenche só campos ainda vazios — nunca sobrepõe o que o utilizador já
  // escreveu (o OCR chega segundos depois de o ecrã abrir).
  function fillFromOcr(ocr: NonNullable<PendingCapture['ocrFields']>) {
    if (ocr.supplierName) setSupplierName((v) => v || ocr.supplierName!);
    if (ocr.issuerNif) setSupplierNif((v) => v || ocr.issuerNif!);
    if (ocr.acquirerNif) setAcquirerNif((v) => v || ocr.acquirerNif!);
    if (ocr.documentId) setDocumentId((v) => v || ocr.documentId!);
    if (ocr.documentTime) setDocumentTime((v) => v || ocr.documentTime!);
    if (ocr.documentDate) setDocumentDate((v) => v || ocr.documentDate!);
    if (ocr.baseAmount != null) setAmountBase((v) => v || ocr.baseAmount!.toFixed(2));
    if (ocr.vatAmount != null) setAmountVat((v) => v || ocr.vatAmount!.toFixed(2));
    if (ocr.totalAmount != null) setAmountTotal((v) => v || ocr.totalAmount!.toFixed(2));
  }

  function fillFromQr(qr: NonNullable<PendingCapture['parsedQr']>) {
    setSupplierNif((v) => v || qr.issuerNif);
    setAcquirerNif((v) => v || qr.acquirerNif);
    setDocumentId((v) => v || qr.documentId);
    setDocumentDate((v) => v || qr.documentDate);
    if (qr.baseAmount !== null) setAmountBase((v) => v || qr.baseAmount!.toFixed(2));
    if (qr.vatAmount !== null) setAmountVat((v) => v || qr.vatAmount!.toFixed(2));
    if (qr.totalAmount !== null) setAmountTotal((v) => v || qr.totalAmount!.toFixed(2));
  }

  useEffect(() => {
    const pending = takePendingCapture();
    setCapture(pending);
    if (!pending) return;
    if (pending.parsedQr) {
      fillFromQr(pending.parsedQr);
    } else if (pending.ocrFields) {
      fillFromOcr(pending.ocrFields);
    } else if (!pending.existingFilePath) {
      // Foto da câmara sem QR lido: envia já a imagem para o servidor, que
      // tenta primeiro decodificar o QR (jsqr apanha códigos que o scanner ao
      // vivo perdeu) e recua para OCR. Além de preencher os campos, o ficheiro
      // fica gravado no servidor (existingFilePath) — o submeter passa a ser
      // instantâneo porque já não reenvia os bytes da foto.
      setAnalyzing(true);
      extractDocument({
        uri: pending.fileUri,
        name: `fatura.${pending.fileMimeType.split('/')[1] ?? 'jpg'}`,
        mimeType: pending.fileMimeType,
      })
        .then((extracted) => {
          setCapture({
            ...pending,
            parsedQr: extracted.parsedQr,
            qrRawPayload: pending.qrRawPayload ?? extracted.qrRawPayload ?? undefined,
            ocrFields: extracted.ocrFields,
            existingFilePath: extracted.originalFilePath,
          });
          if (extracted.parsedQr) {
            fillFromQr(extracted.parsedQr);
          } else if (extracted.ocrFields) {
            fillFromOcr(extracted.ocrFields);
          }
        })
        .catch(() => {
          // Sem rede/OCR indisponível: o utilizador preenche à mão, como antes.
        })
        .finally(() => setAnalyzing(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (capture === undefined) {
    return null;
  }

  if (capture === null) {
    return (
      <View style={[styles.center, { backgroundColor: theme.groupedBackground }]}>
        <Ionicons name="alert-circle-outline" size={40} color={theme.textSecondary} />
        <Text style={[styles.centerText, { color: theme.text }]}>
          Não há nenhuma captura pendente para validar.
        </Text>
        <Pressable style={[styles.primaryButton, { backgroundColor: theme.accent }]} onPress={() => router.replace('/')}>
          <Text style={styles.primaryButtonText}>Voltar à câmara</Text>
        </Pressable>
      </View>
    );
  }

  function hapticError() {
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }

  async function submitExpense(replaceExpenseId?: string) {
    if (!type) {
      hapticError();
      setError('Escolhe o tipo de despesa.');
      return;
    }
    if (currency !== 'EUR' && !/^[A-Z]{3}$/.test(currency)) {
      hapticError();
      setError('Indica um código de moeda válido (3 letras, ex: JPY).');
      return;
    }
    const conversion = currency !== 'EUR' ? convertToEur(amountBase, amountVat, amountTotal, amountTotalEur) : null;
    if (currency !== 'EUR' && !conversion) {
      hapticError();
      setError('Preenche o total em Euro para converter esta despesa.');
      return;
    }
    const effectiveBase = conversion ? conversion.amountBase : parseDecimal(amountBase);
    const effectiveVat = conversion ? conversion.amountVat : parseDecimal(amountVat);
    const effectiveTotal = conversion ? conversion.amountTotal : parseDecimal(amountTotal);
    if (!hasAllAmounts(effectiveBase ?? null, effectiveVat ?? null, effectiveTotal ?? null)) {
      hapticError();
      setError('Preenche os três valores: base, IVA e total.');
      return;
    }
    if (!amountsAreConsistent(effectiveBase ?? null, effectiveVat ?? null, effectiveTotal ?? null)) {
      hapticError();
      setError('Os valores não batem certo: base + IVA tem de ser igual ao total.');
      return;
    }
    if (!nifsAreDistinct(supplierNif, acquirerNif)) {
      hapticError();
      setError('O NIF do prestador e o NIF do utente não podem ser iguais.');
      return;
    }
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    setError(null);
    try {
      const input: ExpenseInput = {
        type,
        source: capture?.source ?? (capture?.existingFilePath ? 'UPLOAD' : 'CAMERA'),
        supplierName: supplierName || undefined,
        supplierNif: supplierNif || undefined,
        acquirerNif: acquirerNif || undefined,
        documentType: capture?.parsedQr?.documentType || undefined,
        documentId: documentId || undefined,
        documentDate: documentDate || undefined,
        documentTime: documentTime || undefined,
        currency,
        amountBase: effectiveBase,
        amountVat: effectiveVat,
        amountTotal: effectiveTotal,
        originalAmountBase: conversion ? parseDecimal(amountBase) : undefined,
        originalAmountVat: conversion ? parseDecimal(amountVat) : undefined,
        originalAmountTotal: conversion ? parseDecimal(amountTotal) : undefined,
        qrRawPayload: capture?.qrRawPayload,
      };
      // Upload manual já processado por /expenses/extract: o ficheiro já está
      // gravado no servidor, não é preciso reenviar os bytes.
      const file =
        capture && !capture.existingFilePath
          ? { uri: capture.fileUri, name: `fatura.${capture.fileMimeType.split('/')[1] ?? 'jpg'}`, mimeType: capture.fileMimeType }
          : undefined;
      await createExpense(input, file, replaceExpenseId, capture?.existingFilePath);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/expenses');
    } catch (err) {
      if (err instanceof DuplicateExpenseError) {
        setSubmitting(false);
        hapticError();
        confirmAction(
          'Documento já existe',
          'Já submeteste uma despesa deste fornecedor com o mesmo número de documento. Queres substituir a despesa existente por esta?',
          'Substituir',
          () => submitExpense(err.existingId),
        );
        return;
      }
      hapticError();
      setError(err instanceof Error ? err.message : 'Falha ao submeter a despesa.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Text style={{ color: theme.accent, fontSize: 16 }}>Cancelar</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView
        style={{ backgroundColor: theme.groupedBackground }}
        contentContainerStyle={[styles.scrollContent, webMaxWidthStyle]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable onPress={() => setPreviewVisible(true)}>
          <Image source={{ uri: capture.fileUri }} style={styles.preview} resizeMode="cover" />
          <View style={styles.previewBadge}>
            <Ionicons name="expand-outline" size={14} color="#fff" />
          </View>
        </Pressable>

        <View
          style={[
            styles.qrBanner,
            {
              backgroundColor: capture.parsedQr
                ? '#34C75920'
                : capture.ocrFields
                  ? '#FF9F0A20'
                  : theme.backgroundElement,
            },
          ]}
        >
          {analyzing ? (
            <ActivityIndicator size="small" color={theme.textSecondary} />
          ) : (
            <Ionicons
              name={capture.parsedQr ? 'checkmark-circle' : capture.ocrFields ? 'text-outline' : 'information-circle-outline'}
              size={18}
              color={capture.parsedQr ? theme.success : capture.ocrFields ? '#FF9F0A' : theme.textSecondary}
            />
          )}
          <Text
            style={[
              styles.qrBannerText,
              { color: capture.parsedQr ? theme.success : capture.ocrFields ? '#FF9F0A' : theme.textSecondary },
            ]}
          >
            {analyzing
              ? 'A analisar a fatura (QR/OCR) — podes ir preenchendo…'
              : capture.parsedQr
                ? `QR code detetado — ATCUD ${capture.parsedQr.atcud || 'n/d'} · doc. ${capture.parsedQr.documentId || 'n/d'}`
                : capture.ocrFields
                  ? 'Extraído por OCR (sem QR) — confirma os campos preenchidos.'
                  : 'Sem QR code — preenche os campos manualmente.'}
          </Text>
        </View>

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

        <Pressable
          style={[styles.submitButton, { backgroundColor: theme.accent, opacity: submitting ? 0.6 : 1 }]}
          onPress={() => submitExpense()}
          disabled={submitting}
        >
          <Text style={styles.submitButtonText}>{submitting ? 'A submeter...' : 'Submeter despesa'}</Text>
        </Pressable>
      </ScrollView>

      {previewVisible && <PhotoLightbox visible uri={capture.fileUri} onClose={() => setPreviewVisible(false)} />}
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
  qrBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    marginTop: 12,
  },
  qrBannerText: { flex: 1, fontSize: 13, fontWeight: '500' },
  conversionPreview: { fontSize: 13, marginTop: 8, marginLeft: 4 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 },
  errorText: { fontSize: 13.5 },
  primaryButton: { paddingVertical: 14, paddingHorizontal: 28, borderRadius: 24 },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  submitButton: { marginTop: 28, paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
  submitButtonText: { color: '#fff', fontSize: 16.5, fontWeight: '600' },
});
