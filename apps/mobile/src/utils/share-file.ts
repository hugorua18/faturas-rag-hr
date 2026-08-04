import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export interface GeneratedReport {
  localUri: string;
  mimeType: string;
  /** Na Web não há ficheiro local nem share sheet — já foi descarregado pelo browser. */
  openedInBrowser?: boolean;
}

// Passo 1: gera/descarrega o relatório sem ainda o partilhar — permite mostrar
// "relatório gerado" e só invocar a share sheet nativa quando o utilizador
// carregar em "Partilhar". Na Web não existe sandbox de ficheiros nem share
// sheet, por isso descarrega diretamente.
// "headers" leva o Authorization: Bearer <token> da sessão — /reports exige
// sessão (requireAuth) tal como /expenses. window.open(url) não consegue
// anexar esse header a uma navegação — batia sempre em 401 "Sessão em falta".
// fetch() já suporta headers; descarrega os bytes e desencadeia a gravação via
// um <a download> clicado por código — ao contrário de window.open chamado
// depois de um await, isto não é bloqueado por bloqueadores de pop-up.
export async function generateReport(
  url: string,
  filename: string,
  mimeType: string,
  headers?: Record<string, string>,
): Promise<GeneratedReport> {
  if (Platform.OS === 'web') {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Falha ao gerar o relatório (${response.status})`);
    }
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    // O Firefox só dispara o download de forma fiável se o <a> estiver no
    // DOM no momento do .click() — remove-se logo a seguir.
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
    return { localUri: blobUrl, mimeType, openedInBrowser: true };
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
