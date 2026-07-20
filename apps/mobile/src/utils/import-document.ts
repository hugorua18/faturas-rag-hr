import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Image as RNImage } from 'react-native';
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

// Variante para a fototeca (expo-image-picker). No iOS 14+/Android 13+ usa o
// seletor de fotos do sistema, que corre fora do processo — o utilizador não
// precisa de conceder acesso a toda a fototeca (não há pedido de permissão em
// bloco; a app só recebe as fotos escolhidas). quality<1 força a reconversão
// para JPEG, o que também resolve fotos HEIC que o servidor não descodifica.
export async function pickAndImportFromGallery(): Promise<boolean> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
  if (result.canceled || !result.assets?.[0]) return false;
  const asset = result.assets[0];
  return importFileAsset({
    uri: asset.uri,
    name: asset.fileName ?? 'fototeca.jpg',
    mimeType: asset.mimeType ?? 'image/jpeg',
  });
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

const UPLOAD_MAX_DIMENSION = 2000;

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    RNImage.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

// Fotos da galeria/ficheiros chegam em resolução total (12 MP ≈ 3–6 MB).
// Reduzir para ≤2000px antes do upload corta o tempo de envio e o de
// processamento no servidor sem perder legibilidade do talão — o QR e o OCR
// trabalham abaixo dessa escala de qualquer forma. Também converte HEIC para
// JPEG de caminho. Qualquer falha aqui é não-fatal: segue o ficheiro original.
async function maybeDownscaleImageAsset(asset: {
  uri: string;
  name: string;
  mimeType?: string | null;
}): Promise<{ uri: string; name: string; mimeType?: string | null }> {
  if (!asset.mimeType?.startsWith('image/')) return asset;
  try {
    const { width, height } = await getImageSize(asset.uri);
    if (Math.max(width, height) <= UPLOAD_MAX_DIMENSION) return asset;
    const resize = width >= height ? { width: UPLOAD_MAX_DIMENSION } : { height: UPLOAD_MAX_DIMENSION };
    const result = await manipulateAsync(asset.uri, [{ resize }], { compress: 0.8, format: SaveFormat.JPEG });
    return {
      uri: result.uri,
      name: `${asset.name.replace(/\.[a-z0-9]+$/i, '')}.jpg`,
      mimeType: 'image/jpeg',
    };
  } catch {
    return asset;
  }
}

async function importFileAsset(asset: { uri: string; name: string; mimeType?: string | null }): Promise<boolean> {
  try {
    const prepared = await maybeDownscaleImageAsset(asset);
    const { parsedQr, qrRawPayload, ocrFields, originalFilePath, fileUrl, fileMimeType } = await extractDocument({
      uri: prepared.uri,
      name: prepared.name,
      mimeType: prepared.mimeType ?? 'application/octet-stream',
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
