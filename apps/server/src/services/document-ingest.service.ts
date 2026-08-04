import path from 'node:path';
import { createCanvas, loadImage, DOMMatrix, type Image } from '@napi-rs/canvas';
import jsQR from 'jsqr';
import { imageSize } from 'image-size';
import { parseInvoiceQr, type ParsedInvoiceQr } from '@invoice-scanner/shared';
import { extractOcrFieldsCascaded, type OcrFields } from './ocr.service';

// Um PDF/imagem pequeno em bytes pode declarar dimensões gigantescas (ex: um
// PNG com um cabeçalho a alegar 50000x50000 píxeis, ou um MediaBox de PDF
// enorme) — decodificar isso aloca memória proporcional aos píxeis, não aos
// bytes comprimidos, e pode esgotar a memória do processo (o limite de 20MB
// do multer só limita o tamanho no disco, não o resultado descomprimido).
// 40 megapíxeis é generoso para qualquer foto/scan real de fatura.
const MAX_DECODED_PIXELS = 40_000_000;

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
  if (viewport.width * viewport.height > MAX_DECODED_PIXELS) {
    throw new Error('Página do PDF excede o tamanho máximo suportado');
  }
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport, canvas: canvas as unknown as HTMLCanvasElement }).promise;
  return canvas.toBuffer('image/png');
}

// Larguras de varrimento do QR, da mais rápida para a mais lenta. O jsQR é
// O(píxeis) e isto corre numa instância com CPU mínima (Render free): numa
// foto de 12 MP demora vários segundos, mas o QR de uma fatura sobrevive bem
// à redução — a ~900px decodifica na esmagadora maioria dos casos em dezenas
// de milissegundos. Só se falhar é que se sobe a resolução; o último passo
// fica limitado a 2600px porque um QR que ainda não decodificou a essa escala
// está tipicamente desfocado, não subamostrado.
const QR_SCAN_WIDTHS = [900, 1600, 2600];

function scaleImageToCanvasData(img: Image, targetWidth: number) {
  const width = Math.min(img.width, targetWidth);
  const height = Math.max(1, Math.round((img.height * width) / img.width));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  return { canvas, width, height };
}

function decodeQrFromImage(img: Image): string | null {
  const triedWidths = new Set<number>();
  for (const targetWidth of QR_SCAN_WIDTHS) {
    const effectiveWidth = Math.min(img.width, targetWidth);
    if (triedWidths.has(effectiveWidth)) continue; // imagem pequena: escalas repetidas
    triedWidths.add(effectiveWidth);
    const { canvas, width, height } = scaleImageToCanvasData(img, targetWidth);
    const imageData = canvas.getContext('2d').getImageData(0, 0, width, height);
    // 'dontInvert': o QR das faturas é sempre escuro sobre claro; tentar
    // também a inversão duplicaria o custo de cada passagem sem ganho real.
    const result = jsQR(imageData.data as unknown as Uint8ClampedArray, width, height, {
      inversionAttempts: 'dontInvert',
    });
    if (result?.data) return result.data;
  }
  return null;
}

export async function ingestDocument(
  buffer: Buffer,
  mimeType: string,
  options?: { ocrTimeoutMs?: number },
): Promise<IngestedDocument> {
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

  // Lê só o cabeçalho (sem descodificar píxeis) para rejeitar uma "bomba de
  // descompressão" antes de loadImage alocar a bitmap completa — um ficheiro
  // pequeno pode declarar dimensões enormes. Falha a ler o cabeçalho (formato
  // que o image-size não reconhece mas o @napi-rs/canvas suporta) não deve
  // bloquear o caminho já existente, por isso segue em frente nesse caso.
  try {
    const declared = imageSize(imageBuffer);
    if (declared.width * declared.height > MAX_DECODED_PIXELS) {
      throw new Error('Imagem excede o tamanho máximo suportado');
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'Imagem excede o tamanho máximo suportado') throw err;
    // cabeçalho não reconhecido pelo image-size — recua para o comportamento anterior
  }

  // A imagem é decodificada UMA vez e reutilizada pelo QR e pelo OCR — a
  // decodificação de um JPEG de 12 MP não é grátis nesta instância.
  const img = await loadImage(imageBuffer);
  const qrText = decodeQrFromImage(img);
  const parsedQr = qrText ? parseInvoiceQr(qrText) : null;

  // OCR é só um fallback quando o QR falha — se já temos um resultado fiável
  // do QR, não vale a pena gastar tempo/CPU a correr o Tesseract. O Tesseract
  // também é O(píxeis): 2200px de largura já dá ~300dpi num talão típico;
  // acima disso só acrescenta tempo, por isso o input é reduzido a essa escala
  // (o ficheiro arquivado continua a ser o original).
  let ocrFields: IngestedDocument['ocrFields'] = null;
  if (!parsedQr) {
    const OCR_MAX_WIDTH = 2200;
    const ocrInput =
      img.width > OCR_MAX_WIDTH ? scaleImageToCanvasData(img, OCR_MAX_WIDTH).canvas.toBuffer('image/png') : imageBuffer;
    ocrFields = (await extractOcrFieldsCascaded(ocrInput, options?.ocrTimeoutMs)).fields;
  }

  return { parsedQr, qrText, ocrFields, imageBuffer, imageMimeType };
}
