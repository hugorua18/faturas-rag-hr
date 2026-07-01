import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import type { MonthlySummary } from '@invoice-scanner/shared';

import { useTheme } from '@/hooks/use-theme';
import {
  getReportExcelUrl,
  getReportPdfUrl,
  getReportRangeExcelUrl,
  getReportRangePdfUrl,
  listMonthlySummaries,
} from '@/api/client';
import { Card, SectionHeader } from '@/components/expense-form';
import { formatPeriodLabel } from '@/utils/format';
import { generateReport, shareGeneratedReport, type GeneratedReport } from '@/utils/share-file';
import { notify } from '@/utils/alert';
import { getSessionToken } from '@/state/session';

interface ReportEntry {
  format: 'pdf' | 'xlsx';
  report: GeneratedReport;
}

export default function ReportGenerateScreen() {
  const theme = useTheme();
  const { nif, period } = useLocalSearchParams<{ nif: string; period?: string }>();
  const [months, setMonths] = useState<MonthlySummary[]>([]);
  const [loadingMonths, setLoadingMonths] = useState(true);
  const [fromPeriod, setFromPeriod] = useState(period ?? '');
  const [toPeriod, setToPeriod] = useState(period ?? '');
  const [includePdf, setIncludePdf] = useState(true);
  const [includeExcel, setIncludeExcel] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportEntry[]>([]);

  useEffect(() => {
    if (!nif) return;
    listMonthlySummaries(nif)
      .then((data) => {
        const sorted = [...data].sort((a, b) => a.period.localeCompare(b.period));
        setMonths(sorted);
        if (!period && sorted.length > 0) {
          const latest = sorted[sorted.length - 1].period;
          setFromPeriod(latest);
          setToPeriod(latest);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Falha ao carregar meses'))
      .finally(() => setLoadingMonths(false));
  }, [nif, period]);

  function reportLabel(): string {
    return fromPeriod === toPeriod
      ? formatPeriodLabel(fromPeriod)
      : `${formatPeriodLabel(fromPeriod)} – ${formatPeriodLabel(toPeriod)}`;
  }

  async function handleGenerate() {
    if (!nif || !fromPeriod || !toPeriod) return;
    if (fromPeriod > toPeriod) {
      setError('O período "De" tem de ser anterior ou igual a "Até".');
      return;
    }
    if (!includePdf && !includeExcel) {
      setError('Escolhe pelo menos um formato.');
      return;
    }
    setGenerating(true);
    setError(null);
    setReports([]);
    const label = reportLabel();
    const results: ReportEntry[] = [];
    const token = await getSessionToken();
    const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;
    try {
      if (includePdf) {
        const url =
          fromPeriod === toPeriod
            ? getReportPdfUrl(nif, fromPeriod, label)
            : getReportRangePdfUrl(nif, fromPeriod, toPeriod, label);
        const report = await generateReport(
          url,
          `relatorio-${nif}-${fromPeriod}-a-${toPeriod}.pdf`,
          'application/pdf',
          authHeaders,
        );
        results.push({ format: 'pdf', report });
      }
      if (includeExcel) {
        const url =
          fromPeriod === toPeriod
            ? getReportExcelUrl(nif, fromPeriod, label)
            : getReportRangeExcelUrl(nif, fromPeriod, toPeriod, label);
        const report = await generateReport(
          url,
          `relatorio-${nif}-${fromPeriod}-a-${toPeriod}.xlsx`,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          authHeaders,
        );
        results.push({ format: 'xlsx', report });
      }
      setReports(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar relatório');
    } finally {
      setGenerating(false);
    }
  }

  async function handleShare(entry: ReportEntry) {
    try {
      await shareGeneratedReport(entry.report);
    } catch (err) {
      notify('Erro', err instanceof Error ? err.message : 'Falha ao partilhar o relatório');
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.groupedBackground }]}>
      <Stack.Screen
        options={{
          title: 'Gerar relatório',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Text style={{ color: theme.accent, fontSize: 16 }}>Cancelar</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {loadingMonths && <ActivityIndicator style={{ marginTop: 16 }} />}

        {!loadingMonths && months.length === 0 && (
          <Text style={[styles.empty, { color: theme.textSecondary }]}>Sem meses disponíveis para este NIF.</Text>
        )}

        {!loadingMonths && months.length > 0 && (
          <>
            <SectionHeader label="De" theme={theme} />
            <View style={styles.chipRow}>
              {months.map((m) => {
                const selected = fromPeriod === m.period;
                return (
                  <Pressable
                    key={m.period}
                    style={[styles.chip, { backgroundColor: selected ? theme.accent : theme.backgroundElement }]}
                    onPress={() => setFromPeriod(m.period)}
                  >
                    <Text style={[styles.chipText, { color: selected ? '#fff' : theme.text }]}>
                      {formatPeriodLabel(m.period)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <SectionHeader label="Até" theme={theme} />
            <View style={styles.chipRow}>
              {months.map((m) => {
                const selected = toPeriod === m.period;
                return (
                  <Pressable
                    key={m.period}
                    style={[styles.chip, { backgroundColor: selected ? theme.accent : theme.backgroundElement }]}
                    onPress={() => setToPeriod(m.period)}
                  >
                    <Text style={[styles.chipText, { color: selected ? '#fff' : theme.text }]}>
                      {formatPeriodLabel(m.period)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <SectionHeader label="Formato" theme={theme} />
            <View style={styles.chipRow}>
              <Pressable
                style={[styles.chip, { backgroundColor: includePdf ? theme.accent : theme.backgroundElement }]}
                onPress={() => setIncludePdf((v) => !v)}
              >
                <Ionicons name="document-text-outline" size={15} color={includePdf ? '#fff' : theme.textSecondary} />
                <Text style={[styles.chipText, { color: includePdf ? '#fff' : theme.text }]}>PDF</Text>
              </Pressable>
              <Pressable
                style={[styles.chip, { backgroundColor: includeExcel ? theme.accent : theme.backgroundElement }]}
                onPress={() => setIncludeExcel((v) => !v)}
              >
                <Ionicons name="grid-outline" size={15} color={includeExcel ? '#fff' : theme.textSecondary} />
                <Text style={[styles.chipText, { color: includeExcel ? '#fff' : theme.text }]}>Excel</Text>
              </Pressable>
            </View>

            {error && (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle" size={16} color={theme.destructive} />
                <Text style={[styles.errorText, { color: theme.destructive }]}>{error}</Text>
              </View>
            )}

            <Pressable
              style={[styles.generateButton, { backgroundColor: theme.accent, opacity: generating ? 0.6 : 1 }]}
              onPress={handleGenerate}
              disabled={generating}
            >
              <Text style={styles.generateButtonText}>{generating ? 'A gerar...' : 'Gerar relatório'}</Text>
            </Pressable>

            {reports.length > 0 && (
              <>
                <SectionHeader label="Relatórios gerados" theme={theme} />
                <Card theme={theme}>
                  {reports.map((entry, index) => (
                    <View
                      key={entry.format}
                      style={[
                        styles.reportRow,
                        index < reports.length - 1 && {
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: theme.separator,
                        },
                      ]}
                    >
                      <Ionicons
                        name={entry.format === 'pdf' ? 'document-text-outline' : 'grid-outline'}
                        size={20}
                        color={theme.textSecondary}
                      />
                      <Text style={[styles.reportRowText, { color: theme.text }]}>
                        {entry.format === 'pdf' ? 'Relatório PDF' : 'Relatório Excel'}
                        {entry.report.openedInBrowser ? ' — aberto numa nova aba' : ' gerado'}
                      </Text>
                      {!entry.report.openedInBrowser && (
                        <Pressable onPress={() => handleShare(entry)} hitSlop={10}>
                          <Text style={[styles.shareLink, { color: theme.accent }]}>Partilhar</Text>
                        </Pressable>
                      )}
                    </View>
                  ))}
                </Card>
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 48, gap: 4 },
  empty: { textAlign: 'center', marginTop: 60, fontSize: 15 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
  },
  chipText: { fontSize: 13.5, fontWeight: '500' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 },
  errorText: { fontSize: 13.5 },
  generateButton: { marginTop: 24, paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
  generateButtonText: { color: '#fff', fontSize: 16.5, fontWeight: '600' },
  reportRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  reportRowText: { flex: 1, fontSize: 14.5 },
  shareLink: { fontSize: 14.5, fontWeight: '600' },
});
