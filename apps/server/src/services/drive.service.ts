import { Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { google, type drive_v3 } from 'googleapis';
import type { User } from '@prisma/client';
import { NO_DATE_KEY } from '@invoice-scanner/shared';
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

export function getDriveClientForUser(user: {
  googleRefreshTokenEnc: string | null;
  googleAuthClientId: string | null;
}): drive_v3.Drive {
  if (!user.googleRefreshTokenEnc) {
    throw new Error('Utilizador sem refresh token do Google Sign-In — não é possível arquivar no Drive');
  }
  const refreshToken = decryptRefreshToken(user.googleRefreshTokenEnc);

  // Um refresh token só é utilizável pelo cliente OAuth que o emitiu: se o login
  // foi feito na app iOS, o refresh tem de usar o cliente iOS (público, sem
  // secret); usar o cliente Web com um token iOS falha com "unauthorized_client".
  // null = linhas antigas, todas emitidas pelo cliente Web.
  if (user.googleAuthClientId && GOOGLE_SIGNIN_IOS_CLIENT_ID && user.googleAuthClientId === GOOGLE_SIGNIN_IOS_CLIENT_ID) {
    const auth = new google.auth.OAuth2(GOOGLE_SIGNIN_IOS_CLIENT_ID);
    auth.setCredentials({ refresh_token: refreshToken });
    return google.drive({ version: 'v3', auth });
  }

  if (!GOOGLE_SIGNIN_CLIENT_ID || !GOOGLE_SIGNIN_CLIENT_SECRET) {
    throw new Error('GOOGLE_SIGNIN_CLIENT_ID / GOOGLE_SIGNIN_CLIENT_SECRET não estão configurados (apps/server/.env)');
  }
  const auth = new google.auth.OAuth2(GOOGLE_SIGNIN_CLIENT_ID, GOOGLE_SIGNIN_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: 'v3', auth });
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

export async function uploadInvoiceToDrive(
  user: User,
  expense: { id: string; acquirerNif: string | null; documentDate: string | null; originalFilePath: string | null },
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
  const filename = `${expense.id}${extensionForMimeType(mimeType)}`;

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
  const year = period.slice(0, 4);
  const folderId = await ensureFolderPath(
    drive,
    ['DespesasApp', 'Relatorios', year, `NIF_${acquirerNif}`],
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
// a cópia durável é a do Drive).
export async function fetchDriveFileStream(
  user: { googleRefreshTokenEnc: string | null; googleAuthClientId: string | null },
  driveFileId: string,
): Promise<{ stream: Readable; mimeType: string }> {
  const drive = getDriveClientForUser(user);
  const response = await drive.files.get({ fileId: driveFileId, alt: 'media' }, { responseType: 'stream' });
  const mimeType = (response.headers as Record<string, string>)['content-type'] ?? 'application/octet-stream';
  return { stream: response.data as unknown as Readable, mimeType };
}

export async function fetchDriveFileBuffer(
  user: { googleRefreshTokenEnc: string | null; googleAuthClientId: string | null },
  driveFileId: string,
): Promise<Buffer> {
  const { stream } = await fetchDriveFileStream(user, driveFileId);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
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
export function archiveInvoiceToDriveBestEffort(
  user: User,
  expense: { id: string; acquirerNif: string | null; documentDate: string | null; originalFilePath: string | null },
): void {
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
