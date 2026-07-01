import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export interface GeneratedReport {
  localUri: string;
  mimeType: string;
  /** Na Web não há ficheiro local nem share sheet — já foi aberto numa nova aba. */
  openedInBrowser?: boolean;
}

// Passo 1: gera/descarrega o relatório sem ainda o partilhar — permite mostrar
// "relatório gerado" e só invocar a share sheet nativa quando o utilizador
// carregar em "Partilhar". Na Web não existe sandbox de ficheiros nem share
// sheet, por isso abre diretamente numa nova aba (o browser trata do download).
// "headers" leva o Authorization: Bearer <token> da sessão — /reports exige
// sessão (requireAuth) tal como /expenses. Nota: no caminho Web (window.open),
// não é possível anexar headers a uma navegação — fica por resolver na Fase 7
// (só afeta o preview Web, não o dispositivo/TestFlight).
export async function generateReport(
  url: string,
  filename: string,
  mimeType: string,
  headers?: Record<string, string>,
): Promise<GeneratedReport> {
  if (Platform.OS === 'web') {
    window.open(url, '_blank');
    return { localUri: url, mimeType, openedInBrowser: true };
  }

  const destination = new File(Paths.cache, filename);
  const file = await File.downloadFileAsync(url, destination, { idempotent: true, headers });
  return { localUri: file.uri, mimeType };
}

// Passo 2: abre a share sheet nativa (email, WhatsApp, SMS, ...) para um
// relatório já gerado pelo passo 1.
export async function shareGeneratedReport(report: GeneratedReport): Promise<void> {
  if (report.openedInBrowser) return;
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('A partilha de ficheiros não está disponível neste dispositivo.');
  }
  await Sharing.shareAsync(report.localUri, {
    mimeType: report.mimeType,
    UTI: report.mimeType === 'application/pdf' ? 'com.adobe.pdf' : undefined,
  });
}
