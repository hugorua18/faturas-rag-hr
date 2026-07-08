import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';

import { extractDocument, resolveFileUrl } from '@/api/client';
import { setPendingCapture } from '@/state/pending-capture';
import { notify } from '@/utils/alert';

// Fluxo partilhado de "importar fatura de um ficheiro" (PDF/imagem): envia
// para /expenses/extract e navega para o ecrã de validação. Usado pelo botão
// de upload da câmara, pelo menu "+" da lista de despesas na Web e pelos
// ficheiros partilhados de outras apps (share sheet do iOS). Devolve true se
// navegou para /validation.
export async function pickAndImportDocument(): Promise<boolean> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'] });
  if (result.canceled || !result.assets?.[0]) return false;
  return importFileAsset(result.assets[0]);
}

const SHARED_FILE_MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

// Ficheiro entregue pelo iOS via share sheet / "Abrir em…" (CFBundleDocumentTypes
// no app.json): chega como URL file:// para a Inbox da app, sem mimeType — é
// inferido da extensão. Segue o mesmo fluxo do upload manual.
export async function importSharedFile(fileUri: string): Promise<boolean> {
  const name = decodeURIComponent(fileUri.split('/').pop() ?? '') || 'documento';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const mimeType = SHARED_FILE_MIME_TYPES[ext];
  if (!mimeType) {
    notify('Ficheiro não suportado', 'Só é possível importar PDFs ou imagens (JPG/PNG).');
    return false;
  }
  return importFileAsset({ uri: fileUri, name, mimeType });
}

async function importFileAsset(asset: { uri: string; name: string; mimeType?: string | null }): Promise<boolean> {
  try {
    const { parsedQr, qrRawPayload, ocrFields, originalFilePath, fileUrl, fileMimeType } = await extractDocument({
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType ?? 'application/octet-stream',
    });
    setPendingCapture({
      fileUri: fileUrl ? resolveFileUrl(fileUrl) : asset.uri,
      source: 'UPLOAD',
      fileMimeType,
      parsedQr,
      qrRawPayload: qrRawPayload ?? undefined,
      ocrFields,
      existingFilePath: originalFilePath,
    });
    router.push('/validation');
    return true;
  } catch (err) {
    notify('Erro', err instanceof Error ? err.message : 'Falha ao processar o ficheiro');
    return false;
  }
}
