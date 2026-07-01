import type { ParsedInvoiceQr } from '@invoice-scanner/shared';

export interface PendingCapture {
  fileUri: string;
  fileMimeType: string;
  /** Dimensões reais em pixel da foto capturada, usadas pelo ecrã de recorte. */
  photoWidth?: number;
  photoHeight?: number;
  parsedQr: ParsedInvoiceQr | null;
  qrRawPayload?: string;
  /** Preenchido pelo fallback OCR (server) quando não há QR — ver document-ingest.service.ts. */
  ocrFields?: Partial<Pick<ParsedInvoiceQr, 'issuerNif' | 'documentDate' | 'vatAmount' | 'totalAmount' | 'baseAmount'>> | null;
  /**
   * Presente quando o ficheiro já foi processado e gravado no servidor (upload
   * manual via /expenses/extract) — o ecrã de validação usa isto para não
   * reenviar os bytes ao submeter, só referenciar o caminho já existente.
   */
  existingFilePath?: string;
}

// Handoff em memória entre os ecrãs de câmara -> recorte -> validação: evita
// ter de serializar uma imagem (potencialmente base64 grande, sobretudo na
// Web) em parâmetros de rota/URL.
let pendingCapture: PendingCapture | null = null;

export function setPendingCapture(capture: PendingCapture): void {
  pendingCapture = capture;
}

export function takePendingCapture(): PendingCapture | null {
  const value = pendingCapture;
  pendingCapture = null;
  return value;
}
