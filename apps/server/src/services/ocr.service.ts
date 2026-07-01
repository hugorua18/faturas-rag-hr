import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { ParsedInvoiceQr } from '@invoice-scanner/shared';

const execFileAsync = promisify(execFile);

// Evita repetir o aviso "tesseract não está instalado" em cada documento —
// é uma condição esperada (ex: ambiente sem Docker), não um erro por pedido.
let hasWarnedMissingTesseract = false;

export async function extractTextViaOcr(imageBuffer: Buffer): Promise<string | null> {
  const tempFilePath = path.join(os.tmpdir(), `${crypto.randomUUID()}.png`);
  try {
    await fs.writeFile(tempFilePath, imageBuffer);
    const { stdout } = await execFileAsync('tesseract', [tempFilePath, 'stdout', '-l', 'por']);
    return stdout;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      if (!hasWarnedMissingTesseract) {
        console.warn('[ocr] binário "tesseract" não encontrado — a saltar fallback OCR.');
        hasWarnedMissingTesseract = true;
      }
      return null;
    }
    console.error('[ocr] falha ao executar OCR sobre o documento', err);
    return null;
  } finally {
    await fs.rm(tempFilePath, { force: true });
  }
}

type OcrFields = Partial<Pick<ParsedInvoiceQr, 'issuerNif' | 'documentDate' | 'vatAmount' | 'totalAmount' | 'baseAmount'>>;

function findIssuerNif(text: string): string | undefined {
  // Heurística: procurar um NIF (9 dígitos) perto de um rótulo "NIF"/"Contribuinte"
  // primeiro (mais fiável), só recuando para a primeira sequência de 9 dígitos
  // solta no texto se não houver nenhum rótulo — ruído de OCR pode produzir
  // falsos positivos (ex: números de telefone, códigos postais concatenados).
  const labelPattern = /\b(nif|contribuinte)\b\D{0,15}(\d{9})/i;
  const labelMatch = text.match(labelPattern);
  if (labelMatch) return labelMatch[2];

  const bareMatch = text.match(/\b\d{9}\b/);
  return bareMatch?.[0];
}

function normalizeOcrDate(day: string, month: string, year: string): string | undefined {
  const dd = day.padStart(2, '0');
  const mm = month.padStart(2, '0');
  const yyyy = year.length === 2 ? `20${year}` : year;
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return undefined;
  return `${yyyy}-${mm}-${dd}`;
}

function findDocumentDate(text: string): string | undefined {
  // Tenta, por ordem, DD/MM/YYYY, DD-MM-YYYY e YYYY-MM-DD — o primeiro padrão
  // que aparecer no texto "ganha"; documentos com várias datas (emissão,
  // validade, etc.) podem produzir um resultado incorreto, mas é o melhor
  // palpite possível sem QR.
  const dmyMatch = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (dmyMatch) {
    const normalized = normalizeOcrDate(dmyMatch[1], dmyMatch[2], dmyMatch[3]);
    if (normalized) return normalized;
  }

  const isoMatch = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const normalized = normalizeOcrDate(isoMatch[3], isoMatch[2], isoMatch[1]);
    if (normalized) return normalized;
  }

  return undefined;
}

function findAmountNear(text: string, labelPattern: RegExp): number | undefined {
  const amountPattern = /(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\s*€?/;
  const labelIndex = text.search(labelPattern);
  if (labelIndex !== -1) {
    const windowText = text.slice(labelIndex, labelIndex + 40);
    const match = windowText.match(amountPattern);
    if (match) {
      const parsed = Number(match[1].replace(/\./g, '').replace(',', '.'));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

export function heuristicFieldsFromOcrText(text: string): OcrFields {
  const fields: OcrFields = {};

  const issuerNif = findIssuerNif(text);
  if (issuerNif) fields.issuerNif = issuerNif;

  const documentDate = findDocumentDate(text);
  if (documentDate) fields.documentDate = documentDate;

  const totalAmount = findAmountNear(text, /\btotal\s*a?\s*pagar\b|\btotal\b/i);
  if (totalAmount !== undefined) fields.totalAmount = totalAmount;

  const vatAmount = findAmountNear(text, /\biva\b/i);
  if (vatAmount !== undefined) fields.vatAmount = vatAmount;

  // Só derivamos a base se ambos os outros valores foram encontrados —
  // adivinhar a partir de só um deles seria inventar dados.
  if (totalAmount !== undefined && vatAmount !== undefined) {
    fields.baseAmount = Math.round((totalAmount - vatAmount) * 100) / 100;
  }

  return fields;
}
