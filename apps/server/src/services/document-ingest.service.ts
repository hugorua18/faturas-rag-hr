import path from 'node:path';
import { createCanvas, loadImage, DOMMatrix } from '@napi-rs/canvas';
import jsQR from 'jsqr';
import { parseInvoiceQr, type ParsedInvoiceQr } from '@invoice-scanner/shared';
import { extractTextViaOcr, heuristicFieldsFromOcrText, type OcrFields } from './ocr.service';

// pdf.js pede um DOMMatrix global para renderizar em Node (normalmente só existe no browser).
(global as unknown as { DOMMatrix?: unknown }).DOMMatrix ??= DOMMatrix;

const standardFontDataUrl = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/';

export interface IngestedDocument {
  parsedQr: ParsedInvoiceQr | null;
  qrText: string | null;
  ocrFields: OcrFields | null;
  imageBuffer: Buffer;
  imageMimeType: 'image/png' | 'image/jpeg';
}

async function renderPdfFirstPageToPng(buffer: Buffer): Promise<Buffer> {
  // pdfjs-dist é só ESM a partir da v6 — import dinâmico para usar a partir deste módulo CommonJS.
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(buffer);
  const pdf = await pdfjsLib.getDocument({ data, standardFontDataUrl }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2.0 });
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport, canvas: canvas as unknown as HTMLCanvasElement }).promise;
  return canvas.toBuffer('image/png');
}

// loadImage() do @napi-rs/canvas trata JPEG/PNG/etc. indiferentemente — não é
// preciso normalizar o formato antes de decodificar o QR.
async function decodeQrFromImageBuffer(imageBuffer: Buffer): Promise<string | null> {
  const img = await loadImage(imageBuffer);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsQR(imageData.data as unknown as Uint8ClampedArray, imageData.width, imageData.height);
  return result?.data ?? null;
}

export async function ingestDocument(buffer: Buffer, mimeType: string): Promise<IngestedDocument> {
  let imageBuffer: Buffer;
  let imageMimeType: 'image/png' | 'image/jpeg';

  if (mimeType === 'application/pdf') {
    imageBuffer = await renderPdfFirstPageToPng(buffer);
    imageMimeType = 'image/png';
  } else if (mimeType.startsWith('image/')) {
    imageBuffer = buffer;
    imageMimeType = mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
  } else {
    throw new Error(`Tipo de ficheiro não suportado: ${mimeType}`);
  }

  const qrText = await decodeQrFromImageBuffer(imageBuffer);
  const parsedQr = qrText ? parseInvoiceQr(qrText) : null;

  // OCR é só um fallback quando o QR falha — se já temos um resultado fiável
  // do QR, não vale a pena gastar tempo/CPU a correr o Tesseract.
  let ocrFields: IngestedDocument['ocrFields'] = null;
  if (!parsedQr) {
    const ocrText = await extractTextViaOcr(imageBuffer);
    if (ocrText) {
      const fields = heuristicFieldsFromOcrText(ocrText);
      ocrFields = Object.keys(fields).length > 0 ? fields : null;
    }
  }

  return { parsedQr, qrText, ocrFields, imageBuffer, imageMimeType };
}
