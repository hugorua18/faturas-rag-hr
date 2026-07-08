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

// O iOS nem sempre entrega o ficheiro partilhado como file://... — o RN/expo
// pode reescrever o caminho embrulhado no scheme da app (ex:
// "invoicescanner://private/var/.../Inbox/fatura.pdf"). Normaliza ambos os
// formatos para um URI file:// utilizável pelo fetch/FormData.
export function normalizeSharedFileUrl(rawUrl: string): string | null {
  if (rawUrl.startsWith('file://')) return rawUrl;
  const wrapped = rawUrl.match(/^[a-z0-9.+-]+:\/\/(.+)$/i);
  if (wrapped) return `file:///${wrapped[1].replace(/^\/+/, '')}`;
  return null;
}

// Ficheiro entregue pelo iOS via share sheet / "Abrir em…" (CFBundleDocumentTypes
// no app.json). Em vez de extrair aqui (que deixava o utilizador preso no ecrã
// "Unmatched Route" do expo-router enquanto o upload corria), navega já para o
// ecrã de validação — que mostra a pré-visualização e faz a extração ele
// próprio, com o estado "A analisar a fatura…".
export function importSharedFile(rawUrl: string): boolean {
  const fileUri = normalizeSharedFileUrl(rawUrl);
  if (!fileUri) return false;
  const name = decodeURIComponent(fileUri.split('/').pop() ?? '') || 'documento';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const mimeType = SHARED_FILE_MIME_TYPES[ext];
  if (!mimeType) {
    notify('Ficheiro não suportado', 'Só é possível importar PDFs ou imagens (JPG/PNG).');
    return false;
  }
  setPendingCapture({ fileUri, fileMimeType: mimeType, source: 'UPLOAD', parsedQr: null });
  router.replace('/validation');
  return true;
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
