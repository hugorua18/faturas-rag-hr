// Reconstrói despesas a partir dos documentos arquivados no Google Drive
// (DespesasApp/<NIF|Sem NIF>/<ano>/<mês>/*.jpg|png) da conta de ingestão.
// Usado após perda dos registos na base (ex.: eliminação de conta): os
// ficheiros do Drive são a cópia durável — cada um volta a passar pelo
// pipeline de extração (QR; OCR se o binário tesseract existir) e vira uma
// despesa nova JÁ LIGADA ao ficheiro existente no Drive (sem re-upload).
//
//   pnpm exec tsx scripts/recover-from-drive.ts            ← simulação (não escreve)
//   pnpm exec tsx scripts/recover-from-drive.ts --apply    ← cria as despesas
//
// Idempotente: ficheiros cujo id já esteja em alguma despesa (driveFileId)
// são ignorados — correr duas vezes não duplica nada.
import type { drive_v3 } from 'googleapis';
import { prisma } from '../src/db/prisma';
import { getDriveClientForUser } from '../src/services/drive.service';
import { ingestDocument } from '../src/services/document-ingest.service';

const OWNER_EMAIL = 'faturas.rag.hr@gmail.com';
const APPLY = process.argv.includes('--apply');

async function listChildren(drive: drive_v3.Drive, folderId: string) {
  const files: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken, files(id, name, mimeType)',
      pageSize: 200,
      pageToken,
    });
    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
  return files;
}

// Nome legível gerado pelo arquivo ("2026-07-07 · LUSO PINSA, LDA. · FT 1A..")
// → devolve o que der para aproveitar; nomes UUID antigos não têm nada útil.
function parseRecoveredFileName(name: string): { date?: string; supplier?: string; docId?: string } {
  const base = name.replace(/\.[a-z0-9]+$/i, '');
  const result: { date?: string; supplier?: string; docId?: string } = {};
  for (const part of base.split(' · ')) {
    const trimmed = part.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) result.date = trimmed;
    else if (/^(FT|FS|FR|VD|NC|ND)[\s.]/i.test(trimmed) || /[A-Z0-9]\/\d+/.test(trimmed)) result.docId = trimmed;
    else if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(trimmed) && trimmed.length > 1) result.supplier ??= trimmed;
  }
  return result;
}

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: { equals: OWNER_EMAIL, mode: 'insensitive' } },
  });
  if (!user) throw new Error(`Utilizador ${OWNER_EMAIL} não existe na base`);
  if (!user.googleRefreshTokenEnc) throw new Error(`${OWNER_EMAIL} não tem refresh token — faz login na app primeiro`);

  const drive = getDriveClientForUser(user);

  const { data: rootSearch } = await drive.files.list({
    q: "name='DespesasApp' and mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields: 'files(id, name)',
  });
  const root = rootSearch.files?.[0];
  if (!root?.id) throw new Error('Pasta DespesasApp não encontrada (o âmbito drive.file só vê ficheiros criados pela app)');

  console.log(`Modo: ${APPLY ? 'APLICAR (vai criar despesas)' : 'SIMULAÇÃO (nada é escrito; usa --apply para criar)'}\n`);

  let seen = 0;
  let created = 0;
  let skipped = 0;
  let manual = 0;
  let failed = 0;

  for (const nifFolder of await listChildren(drive, root.id)) {
    if (!nifFolder.id || nifFolder.mimeType !== 'application/vnd.google-apps.folder') continue;
    if (nifFolder.name === 'Relatorios') continue;
    const acquirerNif = nifFolder.name === 'Sem NIF' ? null : nifFolder.name ?? null;

    // percorre recursivamente <ano>/<mês> (e o que mais houver), sem relatórios
    const stack = [nifFolder.id];
    while (stack.length > 0) {
      const folderId = stack.pop()!;
      for (const entry of await listChildren(drive, folderId)) {
        if (!entry.id || !entry.name) continue;
        if (entry.mimeType === 'application/vnd.google-apps.folder') {
          if (entry.name !== 'Relatorios') stack.push(entry.id);
          continue;
        }
        if (!/\.(jpe?g|png)$/i.test(entry.name)) continue;

        seen++;
        const existing = await prisma.expense.findFirst({
          where: { driveFileId: entry.id },
          select: { id: true, status: true, user: { select: { email: true } } },
        });
        if (existing) {
          skipped++;
          console.log(
            `= [${acquirerNif ?? 'Sem NIF'}] ${entry.name} → já tem despesa ` +
              `(dono: ${existing.user?.email ?? 'NENHUM'}, estado: ${existing.status})`,
          );
          continue;
        }

        try {
          const { data } = await drive.files.get({ fileId: entry.id, alt: 'media' }, { responseType: 'arraybuffer' });
          const buffer = Buffer.from(data as ArrayBuffer);
          const mimeType = /\.png$/i.test(entry.name) ? 'image/png' : 'image/jpeg';
          // Script local, sem timeout de cliente HTTP a pressionar — orçamento
          // generoso para o OCR multilingue ter hipótese em documentos difíceis.
          const { parsedQr, qrText, ocrFields } = await ingestDocument(buffer, mimeType, { ocrTimeoutMs: 120_000 });
          const fromName = parseRecoveredFileName(entry.name);

          // Com QR os dados fiscais estão completos → SUBMETIDA; sem QR faltam
          // os valores → fila de tratamento manual para completar na app.
          const status = parsedQr ? 'SUBMETIDA' : 'TRATAMENTO_MANUAL';
          if (!parsedQr) manual++;

          console.log(`${APPLY ? '+' : '~'} [${acquirerNif ?? 'Sem NIF'}] ${entry.name} → ${status}`);
          if (APPLY) {
            await prisma.expense.create({
              data: {
                userId: user.id,
                status,
                source: 'CAMERA',
                type: 'OUTROS',
                supplierName: ocrFields?.supplierName || fromName.supplier || undefined,
                supplierNif: parsedQr?.issuerNif || ocrFields?.issuerNif || undefined,
                acquirerNif: parsedQr?.acquirerNif || ocrFields?.acquirerNif || acquirerNif || undefined,
                documentType: parsedQr?.documentType || undefined,
                documentId: parsedQr?.documentId || ocrFields?.documentId || fromName.docId || undefined,
                documentDate: parsedQr?.documentDate || ocrFields?.documentDate || fromName.date || undefined,
                amountBase: parsedQr?.baseAmount ?? ocrFields?.baseAmount ?? undefined,
                amountVat: parsedQr?.vatAmount ?? ocrFields?.vatAmount ?? undefined,
                amountTotal: parsedQr?.totalAmount ?? ocrFields?.totalAmount ?? undefined,
                qrRawPayload: qrText || undefined,
                driveFileId: entry.id,
              },
            });
          }
          created++;
        } catch (err) {
          failed++;
          console.error(`! Falha em ${entry.name}:`, err instanceof Error ? err.message : err);
        }
      }
    }
  }

  console.log(
    `\nFicheiros de fatura vistos no Drive: ${seen}\n` +
      `${APPLY ? 'Criadas' : 'A criar (simulação)'}: ${created}  ` +
      `(${manual} sem QR → tratamento manual) | já existentes: ${skipped} | falhas: ${failed}\n` +
      `Se vires no Drive mais ficheiros do que os ${seen} listados acima, o âmbito de acesso ` +
      `está a escondê-los — nesse caso avisa, que a solução é outra.`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
