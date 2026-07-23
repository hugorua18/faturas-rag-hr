import { google, type sheets_v4 } from 'googleapis';
import type { User } from '@prisma/client';
import { prisma } from '../db/prisma';
import { ensureFolderPath, getDriveClientForUser, getGoogleAuthForUser } from './drive.service';

// Registo de documentos em Google Sheets — uma folha "Registo de Documentos"
// dentro de DespesasApp, no Drive de CADA utilizador, com todos os documentos
// e o estado do tratamento. Além de tracking humano, é uma cópia de segurança
// contínua dos dados fiscais fora da nossa base (as imagens já vivem no Drive).
//
// Usa o âmbito drive.file já concedido no login: a API do Sheets aceita esse
// âmbito para ficheiros CRIADOS pela própria app — não é preciso novo
// consentimento. A escrita é sempre uma reescrita completa (limpar + escrever
// tudo), o que a torna idempotente; a folha é só de leitura para o utilizador
// (edições manuais são substituídas na sincronização seguinte).
const SPREADSHEET_NAME = 'Registo de Documentos';
const SYNC_INTERVAL_MS = 30 * 60 * 1000; // varredura de segurança de 30 em 30 min
const DEBOUNCE_MS = 20 * 1000; // sincronização ~20s depois de cada alteração

const HEADER = [
  'Estado',
  'Origem',
  'Tipo',
  'Fornecedor',
  'NIF fornecedor',
  'NIF utente',
  'Nº documento',
  'Data',
  'Hora',
  'Base (€)',
  'IVA (€)',
  'Total (€)',
  'Moeda',
  'Imagem no Drive',
  'Criada em',
  'ID interno',
];

const STATUS_LABELS: Record<string, string> = {
  SUBMETIDA: 'Submetida',
  TRATAMENTO_MANUAL: 'Por tratar (manual)',
};
const SOURCE_LABELS: Record<string, string> = {
  CAMERA: 'Câmara',
  EMAIL: 'Email',
  UPLOAD: 'Upload',
};

// Localiza (ou cria) a folha do utilizador dentro de DespesasApp. O id não é
// persistido na base de propósito — procurar pelo nome torna isto imune a
// resets da base, e o drive.file só devolve ficheiros criados pela app.
async function ensureSpreadsheet(user: User): Promise<string> {
  const drive = getDriveClientForUser(user);
  const { data } = await drive.files.list({
    q: `name='${SPREADSHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: 'files(id, name)',
  });
  const existing = data.files?.[0];
  if (existing?.id) return existing.id;

  const folderId = await ensureFolderPath(drive, ['DespesasApp'], user.driveRootFolderId);
  const { data: created } = await drive.files.create({
    requestBody: {
      name: SPREADSHEET_NAME,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [folderId],
    },
    fields: 'id',
  });
  if (!created.id) throw new Error('Falha ao criar a folha de registo no Drive');
  console.log(`[sheets] folha "${SPREADSHEET_NAME}" criada para ${user.email}`);
  return created.id;
}

async function syncUserToSheet(user: User): Promise<void> {
  const expenses = await prisma.expense.findMany({
    where: { userId: user.id },
    orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }],
  });

  const rows = expenses.map((expense) => [
    STATUS_LABELS[expense.status] ?? expense.status,
    SOURCE_LABELS[expense.source] ?? expense.source,
    expense.type,
    expense.supplierName ?? '',
    expense.supplierNif ?? '',
    expense.acquirerNif ?? '',
    expense.documentId ?? '',
    expense.documentDate ?? '',
    expense.documentTime ?? '',
    expense.amountBase ?? '',
    expense.amountVat ?? '',
    expense.amountTotal ?? '',
    (expense as { currency?: string | null }).currency ?? 'EUR',
    expense.driveFileId ? `https://drive.google.com/file/d/${expense.driveFileId}/view` : '',
    expense.createdAt.toISOString().slice(0, 16).replace('T', ' '),
    expense.id,
  ]);

  const spreadsheetId = await ensureSpreadsheet(user);
  const sheets: sheets_v4.Sheets = google.sheets({ version: 'v4', auth: getGoogleAuthForUser(user) });

  await sheets.spreadsheets.values.clear({ spreadsheetId, range: 'A:Z' });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [HEADER, ...rows] },
  });
  console.log(`[sheets] registo de ${user.email} sincronizado (${rows.length} documento(s))`);
}

async function syncAllUsers(): Promise<void> {
  const users = await prisma.user.findMany({ where: { googleRefreshTokenEnc: { not: null } } });
  for (const user of users) {
    const count = await prisma.expense.count({ where: { userId: user.id } });
    if (count === 0) continue; // não criar folhas vazias em contas sem uso
    try {
      await syncUserToSheet(user);
    } catch (err) {
      console.error(`[sheets] falha a sincronizar o registo de ${user.email}`, err);
    }
  }
}

// Sincronização "logo a seguir" a uma alteração (criação/edição/eliminação de
// despesa) — com debounce por utilizador para agrupar rajadas de alterações.
const pendingSyncs = new Map<string, NodeJS.Timeout>();

export function scheduleSheetsSyncSoon(userId: string | null | undefined): void {
  if (!userId) return;
  const existing = pendingSyncs.get(userId);
  if (existing) clearTimeout(existing);
  pendingSyncs.set(
    userId,
    setTimeout(() => {
      pendingSyncs.delete(userId);
      void (async () => {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user?.googleRefreshTokenEnc) return;
        try {
          await syncUserToSheet(user);
        } catch (err) {
          console.error(`[sheets] falha na sincronização pós-alteração (${user.email})`, err);
        }
      })();
    }, DEBOUNCE_MS),
  );
}

export function startSheetsExport(): void {
  // Primeira varredura pouco depois do arranque (deixa o servidor estabilizar),
  // depois de 30 em 30 minutos como rede de segurança para o que escapar ao
  // debounce (ex.: alterações feitas mesmo antes de um deploy).
  setTimeout(() => void syncAllUsers(), 60 * 1000);
  setInterval(() => void syncAllUsers(), SYNC_INTERVAL_MS);
  console.log('[sheets] exportação para Google Sheets ativa (varredura a cada 30 min + pós-alteração)');
}
