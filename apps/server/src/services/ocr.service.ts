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

// Faturas de viagem vêm em várias línguas — mas pedir todas de uma vez ao
// tesseract é sensivelmente mais lento do que só português (ver cascata em
// extractOcrFieldsCascaded abaixo). A lista efetiva de cada tentativa é a
// INTERSEÇÃO com os pacotes instalados (tesseract rebenta se lhe pedirem uma
// língua sem dados de treino) — os idiomas instalados são resolvidos uma vez
// e reutilizados.
const PRIMARY_OCR_LANGUAGES = ['por'];
const FALLBACK_OCR_LANGUAGES = ['por', 'spa', 'fra', 'deu', 'ita'];
let cachedInstalledLanguages: Set<string> | null = null;

async function getInstalledLanguages(): Promise<Set<string>> {
  if (cachedInstalledLanguages) return cachedInstalledLanguages;
  try {
    const { stdout } = await execFileAsync('tesseract', ['--list-langs']);
    cachedInstalledLanguages = new Set(
      stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^[a-z_]{3,}$/i.test(line)),
    );
  } catch {
    cachedInstalledLanguages = new Set(['por']); // sem --list-langs, assume só o essencial
  }
  return cachedInstalledLanguages;
}

async function resolveLanguageArg(wanted: string[]): Promise<string> {
  const installed = await getInstalledLanguages();
  const usable = wanted.filter((lang) => installed.has(lang));
  if (usable.length < wanted.length) {
    console.warn(`[ocr] línguas em falta (${wanted.filter((l) => !installed.has(l)).join(', ')})`);
  }
  return usable.length > 0 ? usable.join('+') : 'por';
}

async function extractTextViaOcr(imageBuffer: Buffer, languages: string[], timeoutMs: number): Promise<string | null> {
  const tempFilePath = path.join(os.tmpdir(), `${crypto.randomUUID()}.png`);
  try {
    await fs.writeFile(tempFilePath, imageBuffer);
    const langArg = await resolveLanguageArg(languages);
    const { stdout } = await execFileAsync('tesseract', [tempFilePath, 'stdout', '-l', langArg], { timeout: timeoutMs });
    return stdout;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      if (!hasWarnedMissingTesseract) {
        console.warn('[ocr] binário "tesseract" não encontrado — a saltar fallback OCR.');
        hasWarnedMissingTesseract = true;
      }
      return null;
    }
    if ((err as NodeJS.ErrnoException & { killed?: boolean })?.killed) {
      console.warn(`[ocr] OCR (${languages.join('+')}) excedeu o limite de ${timeoutMs}ms — a passar à frente.`);
      return null;
    }
    console.error('[ocr] falha ao executar OCR sobre o documento', err);
    return null;
  } finally {
    await fs.rm(tempFilePath, { force: true });
  }
}

// Orçamento TOTAL por omissão para o caminho interativo (upload/câmara/
// poller): tem de responder dentro do timeout de 60s do cliente
// (apps/mobile/src/api/client.ts), que também inclui a renderização do PDF e
// a viagem de rede — 25s deixa margem. Sem um limite destes, um documento
// difícil podia ultrapassar os 60s do cliente e a extração falhava SEM
// devolver sequer a imagem rasterizada — a app ficava sem pré-visualização
// nenhuma (nem OCR nem o ficheiro). O script de recuperação
// (scripts/refill-manual-expenses.ts) corre localmente sem esta pressão e
// passa um orçamento maior.
const DEFAULT_OCR_TOTAL_TIMEOUT_MS = 25_000;

// Cascata: tenta primeiro só português (rápido, cobre a esmagadora maioria
// das faturas desta app) — só recorre ao conjunto multilingue se o português
// não encontrar NADA de aproveitável, e sempre dentro do orçamento total
// (o que sobrar da primeira tentativa). Devolve o texto bruto (para logging)
// e os campos já extraídos pelas heurísticas.
export async function extractOcrFieldsCascaded(
  imageBuffer: Buffer,
  totalTimeoutMs = DEFAULT_OCR_TOTAL_TIMEOUT_MS,
): Promise<{ text: string | null; fields: OcrFields | null }> {
  const started = Date.now();
  // A maior parte do orçamento vai para a 1ª tentativa (a que quase sempre
  // resolve); o mínimo de 3s para a 2ª evita gastar tudo sem dar hipótese
  // real ao multilingue.
  const primaryTimeout = Math.max(3_000, totalTimeoutMs - 3_000);
  const primaryText = await extractTextViaOcr(imageBuffer, PRIMARY_OCR_LANGUAGES, primaryTimeout);
  const primaryFields = primaryText ? heuristicFieldsFromOcrText(primaryText) : {};
  if (Object.keys(primaryFields).length > 0) {
    return { text: primaryText, fields: primaryFields };
  }

  const remaining = totalTimeoutMs - (Date.now() - started);
  if (remaining < 3_000) {
    return { text: primaryText, fields: null };
  }
  const fallbackText = await extractTextViaOcr(imageBuffer, FALLBACK_OCR_LANGUAGES, remaining);
  const fallbackFields = fallbackText ? heuristicFieldsFromOcrText(fallbackText) : {};
  if (Object.keys(fallbackFields).length > 0) {
    return { text: fallbackText, fields: fallbackFields };
  }
  return { text: fallbackText ?? primaryText, fields: null };
}

export type OcrFields = Partial<
  Pick<ParsedInvoiceQr, 'issuerNif' | 'acquirerNif' | 'documentDate' | 'documentId' | 'vatAmount' | 'totalAmount' | 'baseAmount'>
> & {
  /** Não existem no QR (Portaria 195/2020) — só o OCR os consegue dar. */
  supplierName?: string;
  documentTime?: string;
};

// Dígito de controlo do NIF (mod 11) — filtra o grosso dos falsos positivos do
// OCR (telefones, códigos postais concatenados, totais sem separador decimal).
function isValidPtNif(nif: string): boolean {
  if (!/^\d{9}$/.test(nif)) return false;
  const digits = [...nif].map(Number);
  const sum = digits.slice(0, 8).reduce((acc, digit, index) => acc + digit * (9 - index), 0);
  const check = 11 - (sum % 11);
  return digits[8] === (check >= 10 ? 0 : check);
}

// Nos talões certificados pela AT o NIF do CLIENTE vem rotulado ("NIF Cliente",
// "Contribuinte: ...", "NIF Consumidor") — o do emitente costuma estar no
// cabeçalho, perto do nome/morada, muitas vezes só "NIF: xxxxxxxxx".
function findAcquirerNif(text: string): string | undefined {
  const labeled = text.matchAll(
    /\b(?:nif|n\.?º?\s*contribuinte|contribuinte)\s*(?:do\s*)?(?:cliente|consumidor|adquirente)\b\D{0,15}(\d{9})/gi,
  );
  for (const match of labeled) {
    if (isValidPtNif(match[1])) return match[1];
  }
  return undefined;
}

function findIssuerNif(text: string, acquirerNif: string | undefined): string | undefined {
  // Primeiro NIF válido com rótulo genérico que não seja o do cliente…
  for (const match of text.matchAll(/\b(?:nif|nipc|contribuinte)\b\D{0,15}(\d{9})/gi)) {
    if (isValidPtNif(match[1]) && match[1] !== acquirerNif) return match[1];
  }
  // …senão, primeira sequência de 9 dígitos que passe no dígito de controlo.
  for (const match of text.matchAll(/\b(\d{9})\b/g)) {
    if (isValidPtNif(match[1]) && match[1] !== acquirerNif) return match[1];
  }
  return undefined;
}

// O nome do estabelecimento é tipicamente a primeira linha "de texto" do
// talão — antes de moradas, NIFs e rótulos de tipo de documento.
const NAME_SKIP_PATTERN =
  /fatura|factura|recibo|simplificad|venda\s+a\s+dinheiro|documento|original|duplicado|c[óo]pia|tal[ãa]o|consumidor|processado|programa|licen[çc]a|www\.|http/i;

function findSupplierName(text: string): string | undefined {
  for (const rawLine of text.split('\n').slice(0, 8)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (line.length < 4 || line.length > 60) continue;
    const letters = line.match(/[a-záàâãçéêíóôõú]/gi)?.length ?? 0;
    if (letters < 4 || letters < line.length * 0.5) continue;
    if (NAME_SKIP_PATTERN.test(line)) continue;
    return line;
  }
  return undefined;
}

function findDocumentTime(text: string): string | undefined {
  const match = text.match(/\b([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/);
  return match ? `${match[1]}:${match[2]}` : undefined;
}

// Nº de documento no formato AT "SÉRIE/NÚMERO" (ex: "FS SPSS1/482920",
// "FT 2026A/123") — o prefixo é o tipo de documento (FT/FS/FR/VD/NC/ND).
function findDocumentId(text: string): string | undefined {
  const match = text.match(/\b((?:FT|FS|FR|VD|NC|ND)\s?[A-Z0-9.-]{0,12}\/\d{1,10})\b/i);
  return match ? match[1].replace(/\s+/g, ' ').trim().toUpperCase() : undefined;
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
  const dmyMatch = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
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

  const acquirerNif = findAcquirerNif(text);
  if (acquirerNif) fields.acquirerNif = acquirerNif;

  const issuerNif = findIssuerNif(text, acquirerNif);
  if (issuerNif) fields.issuerNif = issuerNif;

  const supplierName = findSupplierName(text);
  if (supplierName) fields.supplierName = supplierName;

  const documentDate = findDocumentDate(text);
  if (documentDate) fields.documentDate = documentDate;

  const documentTime = findDocumentTime(text);
  if (documentTime) fields.documentTime = documentTime;

  const documentId = findDocumentId(text);
  if (documentId) fields.documentId = documentId;

  const totalAmount = findAmountNear(text, /\btotal\s*a\s*pagar\b|\bvalor\s*a\s*pagar\b|\btotal\b|\bmontante\b/i);
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
