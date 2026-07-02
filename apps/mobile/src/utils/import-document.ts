import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';

import { extractDocument, resolveFileUrl } from '@/api/client';
import { setPendingCapture } from '@/state/pending-capture';
import { notify } from '@/utils/alert';

// Fluxo partilhado de "importar fatura de um ficheiro" (PDF/imagem): abre o
// seletor, envia para /expenses/extract e navega para o ecrã de validação.
// Usado pelo botão de upload da câmara e pelo menu "+" da lista de despesas
// na Web. Devolve true se navegou para /validation (para quem precisa de
// gerir estado "busy" à volta).
export async function pickAndImportDocument(): Promise<boolean> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'] });
  if (result.canceled || !result.assets?.[0]) return false;
  const asset = result.assets[0];

  try {
    const { parsedQr, qrRawPayload, ocrFields, originalFilePath, fileUrl, fileMimeType } = await extractDocument({
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType ?? 'application/octet-stream',
    });
    setPendingCapture({
      fileUri: fileUrl ? resolveFileUrl(fileUrl) : asset.uri,
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
