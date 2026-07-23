import { Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { google, type drive_v3 } from 'googleapis';
import type { User } from '@prisma/client';
import { NO_DATE_KEY, NO_NIF_KEY } from '@invoice-scanner/shared';
import { prisma } from '../db/prisma';
import { decryptRefreshToken } from './google-auth.service';
import { resolveSafeUploadPath } from '../utils/uploads-path';

// Mesmas variáveis do Google Sign-In (Fase 7) — NÃO as do poller do Gmail
// (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN), que são um fluxo
// OAuth completamente separado para uma caixa de correio de ingestão dedicada.
// .trim(): ver google-auth.service.ts — valores colados no Render podem trazer
// whitespace invisível que quebra comparações exatas.
const GOOGLE_SIGNIN_CLIENT_ID = process.env.GOOGLE_SIGNIN_CLIENT_ID?.trim();
const GOOGLE_SIGNIN_CLIENT_SECRET = process.env.GOOGLE_SIGNIN_CLIENT_SECRET?.trim();
const GOOGLE_SIGNIN_IOS_CLIENT_ID = process.env.GOOGLE_SIGNIN_IOS_CLIENT_ID?.trim();

// Constrói o cliente OAuth autenticado do utilizador — partilhado pelo Drive
// (arquivo de faturas) e pelo Sheets (registo de documentos). Um refresh token
// só é utilizável pelo cliente OAuth que o emitiu: se o login foi feito na app
// iOS, o refresh tem de usar o cliente iOS (público, sem secret); usar o
// cliente Web com um token iOS falha com "unauthorized_client". null = linhas
// antigas, todas emitidas pelo cliente Web.
export function getGoogleAuthForUser(user: {
  googleRefreshTokenEnc: string | null;
  googleAuthClientId: string | null;
}) {
  if (!user.googleRefreshTokenEnc) {
    throw new Error('Utilizador sem refresh token do Google Sign-In — não é possível aceder ao Drive/Sheets');
  }
  const refreshToken = decryptRefreshToken(user.googleRefreshTokenEnc);

  if (user.googleAuthClientId && GOOGLE_SIGNIN_IOS_CLIENT_ID && user.googleAuthClientId === GOOGLE_SIGNIN_IOS_CLIENT_ID) {
    const auth = new google.auth.OAuth2(GOOGLE_SIGNIN_IOS_CLIENT_ID);
    auth.setCredentials({ refresh_token: refreshToken });
    return auth;
  }

  if (!GOOGLE_SIGNIN_CLIENT_ID || !GOOGLE_SIGNIN_CLIENT_SECRET) {
    throw new Error('GOOGLE_SIGNIN_CLIENT_ID / GOOGLE_SIGNIN_CLIENT_SECRET não estão configurados (apps/server/.env)');
  }
  const auth = new google.auth.OAuth2(GOOGLE_SIGNIN_CLIENT_ID, GOOGLE_SIGNIN_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

export function getDriveClientForUser(user: {
  googleRefreshTokenEnc: string | null;
  googleAuthClientId: string | null;
}): drive_v3.Drive {
  return google.drive({ version: 'v3', auth: getGoogleAuthForUser(user) });
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/'/g, "\\'");
}

// "mkdir -p" para o Drive: idempotente, reaproveita pastas já criadas em vez de duplicar.
export async function ensureFolderPath(
  drive: drive_v3.Drive,
  segments: string[],
  rootFolderId?: string | null,
): Promise<string> {
  let parentId = rootFolderId || 'root';
  for (const segment of segments) {
    const query = `name='${escapeDriveQueryValue(segment)}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
    const { data } = await drive.files.list({ q: query, fields: 'files(id, name)', spaces: 'drive' });
    const existing = data.files?.[0];
    if (existing?.id) {
      parentId = existing.id;
      continue;
    }
    const { data: created } = await drive.files.create({
      requestBody: { name: segment, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
      fields: 'id',
    });
    if (!created.id) {
      throw new Error(`Falha ao criar a pasta "${segment}" no Drive`);
    }
    parentId = created.id;
  }
  return parentId;
}

function extensionForMimeType(mimeType: string): string {
  return mimeType === 'image/png' ? '.png' : '.jpg';
}

// Nome legível para o ficheiro no Drive — um humano a navegar nas pastas deve
// perceber o que é sem abrir ("2026-07-07 · LUSO PINSA, LDA. · FT 1A2601-3896"),
// em vez do UUID interno da despesa. Caracteres problemáticos são substituídos
// e o comprimento limitado; recua para o id quando não há nenhum campo útil.
function driveInvoiceFileName(expense: InvoiceForDrive, mimeType: string): string {
  const sanitize = (value: string) => value.replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  const parts = [expense.documentDate, expense.supplierName || expense.supplierNif, expense.documentId]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map(sanitize);
  const base = parts.length > 0 ? parts.join(' · ').slice(0, 120) : expense.id;
  return `${base}${extensionForMimeType(mimeType)}`;
}

interface InvoiceForDrive {
  id: string;
  acquirerNif: string | null;
  documentDate: string | null;
  originalFilePath: string | null;
  supplierName?: string | null;
  supplierNif?: string | null;
  documentId?: string | null;
}

export async function uploadInvoiceToDrive(
  user: User,
  expense: InvoiceForDrive,
  fileBuffer: Buffer,
  mimeType: string,
): Promise<string> {
  const drive = getDriveClientForUser(user);
  // Uma pasta por NIF adquirente em vez de uma pasta única "Faturas" — espelha
  // a organização da app (despesas agrupadas por NIF) e facilita entregar as
  // faturas de um NIF ao contabilista sem misturar com as dos outros.
  const nifFolder = expense.acquirerNif || 'Sem NIF';
  const year = expense.documentDate ? expense.documentDate.slice(0, 4) : NO_DATE_KEY;
  const month = expense.documentDate ? expense.documentDate.slice(5, 7) : NO_DATE_KEY;
  const folderId = await ensureFolderPath(drive, ['DespesasApp', nifFolder, year, month], user.driveRootFolderId);
  const filename = driveInvoiceFileName(expense, mimeType);

  const { data } = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    // A API do Drive espera um stream no corpo do media, não um Buffer em memória.
    media: { mimeType, body: Readable.from(fileBuffer) },
    fields: 'id',
  });
  if (!data.id) {
    throw new Error('Falha ao carregar o ficheiro para o Drive: resposta sem id');
  }
  return data.id;
}

export async function uploadReportToDrive(
  user: User,
  acquirerNif: string,
  period: string,
  fileBuffer: Buffer,
  mimeType: string,
  extension: 'pdf' | 'xlsx',
): Promise<string> {
  const drive = getDriveClientForUser(user);
  // Relatórios vivem DENTRO da pasta do próprio NIF (DespesasApp/<NIF>/Relatorios),
  // ao lado das faturas desse NIF — tudo o que pertence a um NIF fica junto,
  // pronto a entregar ao contabilista de uma vez.
  const nifFolder = acquirerNif === NO_NIF_KEY ? 'Sem NIF' : acquirerNif;
  const folderId = await ensureFolderPath(
    drive,
    ['DespesasApp', nifFolder, 'Relatorios'],
    user.driveRootFolderId,
  );
  const filename = `Relatorio_${period}.${extension}`;

  const { data } = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType, body: Readable.from(fileBuffer) },
    fields: 'id',
  });
  if (!data.id) {
    throw new Error('Falha ao carregar o relatório para o Drive: resposta sem id');
  }
  return data.id;
}

// Lê de volta um ficheiro arquivado no Drive — usado quando o ficheiro local
// já não existe (o disco do Render free é efémero: cada deploy limpa uploads/;
// a cópia durável é a do Drive). responseType 'arraybuffer' de propósito, NÃO
// 'stream': o gaxios moderno devolve streams WHATWG (sem .pipe()), o que fazia
// a rota /expenses/:id/file rebentar — o relatório (que iterava o stream)
// funcionava e a app (que fazia .pipe) mostrava a imagem em branco.
export async function fetchDriveFileBuffer(
  user: { googleRefreshTokenEnc: string | null; googleAuthClientId: string | null },
  driveFileId: string,
): Promise<Buffer> {
  const drive = getDriveClientForUser(user);
  const response = await drive.files.get({ fileId: driveFileId, alt: 'media' }, { responseType: 'arraybuffer' });
  return Buffer.from(response.data as ArrayBuffer);
}

// Content-Type pelos bytes (magic numbers) — os headers do Drive não são
// fiáveis entre versões do cliente e a app precisa do tipo certo para
// renderizar a imagem/PDF.
export function detectFileMimeType(buffer: Buffer): string {
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length > 4 && buffer.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  return 'image/jpeg';
}

function mimeTypeForFilePath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'image/png';
}

// Arquivo no Drive é best-effort: nunca deve atrasar/bloquear a resposta ao
// cliente nem falhar o pedido — a despesa já está guardada localmente, que é
// o que importa. Falhas (sem refresh token, erro de rede/API) só são logadas,
// por isso corre em segundo plano (não é feito "await" pelos chamadores).
// Vive aqui (e não em routes/expenses.ts) para o poller do Gmail também o
// poder usar sem criar um ciclo de imports.
export function archiveInvoiceToDriveBestEffort(user: User, expense: InvoiceForDrive): void {
  const absolutePath = resolveSafeUploadPath(expense.originalFilePath);
  if (!absolutePath) return;
  void (async () => {
    try {
      const fileBuffer = fs.readFileSync(absolutePath);
      const mimeType = mimeTypeForFilePath(expense.originalFilePath!);
      const driveFileId = await uploadInvoiceToDrive(user, expense, fileBuffer, mimeType);
      await prisma.expense.update({ where: { id: expense.id }, data: { driveFileId } });
    } catch (err) {
      console.error(`[drive] falha ao arquivar a despesa ${expense.id} no Drive`, err);
    }
  })();
}
