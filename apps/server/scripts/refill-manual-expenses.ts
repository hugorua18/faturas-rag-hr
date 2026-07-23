// Segunda passagem de extração para as despesas recuperadas do Drive que
// ficaram em TRATAMENTO_MANUAL (sem QR na primeira tentativa): baixa a imagem
// do Drive, tenta o QR de novo e corre OCR (tesseract local, se instalado —
// `brew install tesseract tesseract-lang`), preenchendo os campos em falta.
// Se o QR for encontrado, os dados fiscais ficam completos e a despesa é
// promovida a SUBMETIDA; com OCR apenas, fica na fila para validação humana,
// mas já pré-preenchida.
//
//   pnpm exec tsx scripts/refill-manual-expenses.ts            ← simulação
//   pnpm exec tsx scripts/refill-manual-expenses.ts --apply    ← grava
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseInvoiceQr, type ParsedInvoiceQr } from '@invoice-scanner/shared';
import { prisma } from '../src/db/prisma';
import { detectFileMimeType, fetchDriveFileBuffer } from '../src/services/drive.service';
import { ingestDocument } from '../src/services/document-ingest.service';

const OWNER_EMAIL = 'faturas.rag.hr@gmail.com';
const APPLY = process.argv.includes('--apply');
const execFileAsync = promisify(execFile);

// Fallback com o Vision da Apple (scripts/decode-qr.swift) — o mesmo motor da
// câmara do iPhone, que leu estes QR na altura da digitalização. O jsQR falha
// em muitas fotos recomprimidas onde o Vision acerta.
async function decodeQrWithVision(buffer: Buffer): Promise<string | null> {
  const tmpPath = path.join(os.tmpdir(), `qr-${crypto.randomUUID()}.img`);
  fs.writeFileSync(tmpPath, buffer);
  try {
    const { stdout } = await execFileAsync(
      'swift',
      [path.join(__dirname, 'decode-qr.swift'), tmpPath],
      { timeout: 120000 },
    );
    const payload = stdout.trim();
    return payload.length > 0 ? payload : null;
  } catch {
    return null; // swift indisponível ou sem QR — segue sem Vision
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: { equals: OWNER_EMAIL, mode: 'insensitive' } },
  });
  if (!user?.googleRefreshTokenEnc) throw new Error(`${OWNER_EMAIL} sem sessão/refresh token`);

  const pending = await prisma.expense.findMany({
    where: { userId: user.id, status: 'TRATAMENTO_MANUAL', driveFileId: { not: null } },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Modo: ${APPLY ? 'APLICAR' : 'SIMULAÇÃO (usa --apply para gravar)'}`);
  console.log(`Despesas em tratamento manual com ficheiro no Drive: ${pending.length}\n`);

  let promoted = 0;
  let enriched = 0;
  let untouched = 0;

  for (const expense of pending) {
    try {
      const buffer = await fetchDriveFileBuffer(user, expense.driveFileId!);
      const ingest = await ingestDocument(buffer, detectFileMimeType(buffer));
      let parsedQr: ParsedInvoiceQr | null = ingest.parsedQr;
      let qrText = ingest.qrText;
      const ocrFields = ingest.ocrFields;
      let viaVision = false;

      if (!parsedQr) {
        const visionPayload = await decodeQrWithVision(buffer);
        if (visionPayload) {
          try {
            const visionParsed = parseInvoiceQr(visionPayload);
            if (visionParsed) {
              parsedQr = visionParsed;
              qrText = visionPayload;
              viaVision = true;
            }
          } catch {
            // QR que não é de fatura (ex.: link) — ignora
          }
        }
      }

      // QR é autoritativo (dados exatos da AT) — sobrepõe; OCR só preenche vazios.
      const updates: Record<string, unknown> = {};
      if (parsedQr) {
        if (parsedQr.issuerNif) updates.supplierNif = parsedQr.issuerNif;
        if (parsedQr.acquirerNif) updates.acquirerNif = parsedQr.acquirerNif;
        if (parsedQr.documentType) updates.documentType = parsedQr.documentType;
        if (parsedQr.documentId) updates.documentId = parsedQr.documentId;
        if (parsedQr.documentDate) updates.documentDate = parsedQr.documentDate;
        if (parsedQr.baseAmount != null) updates.amountBase = parsedQr.baseAmount;
        if (parsedQr.vatAmount != null) updates.amountVat = parsedQr.vatAmount;
        if (parsedQr.totalAmount != null) updates.amountTotal = parsedQr.totalAmount;
        if (qrText) updates.qrRawPayload = qrText;
        updates.status = 'SUBMETIDA';
      } else if (ocrFields) {
        if (!expense.supplierName && ocrFields.supplierName) updates.supplierName = ocrFields.supplierName;
        if (!expense.supplierNif && ocrFields.issuerNif) updates.supplierNif = ocrFields.issuerNif;
        if (!expense.acquirerNif && ocrFields.acquirerNif) updates.acquirerNif = ocrFields.acquirerNif;
        if (!expense.documentId && ocrFields.documentId) updates.documentId = ocrFields.documentId;
        if (!expense.documentDate && ocrFields.documentDate) updates.documentDate = ocrFields.documentDate;
        if (!expense.documentTime && ocrFields.documentTime) updates.documentTime = ocrFields.documentTime;
        if (expense.amountBase == null && ocrFields.baseAmount != null) updates.amountBase = ocrFields.baseAmount;
        if (expense.amountVat == null && ocrFields.vatAmount != null) updates.amountVat = ocrFields.vatAmount;
        if (expense.amountTotal == null && ocrFields.totalAmount != null) updates.amountTotal = ocrFields.totalAmount;
      }

      const changedKeys = Object.keys(updates);
      if (changedKeys.length === 0) {
        untouched++;
        console.log(`. ${expense.id.slice(0, 8)}…  sem dados novos (QR ilegível e OCR sem resultados)`);
        continue;
      }
      if (updates.status === 'SUBMETIDA') promoted++;
      else enriched++;
      console.log(
        `${updates.status === 'SUBMETIDA' ? '✔' : '+'} ${expense.id.slice(0, 8)}…  ` +
          `${
            updates.status === 'SUBMETIDA'
              ? `QR encontrado${viaVision ? ' (Vision)' : ''} → SUBMETIDA`
              : 'OCR preencheu'
          }: ${changedKeys.join(', ')}`,
      );
      if (APPLY) {
        await prisma.expense.update({ where: { id: expense.id }, data: updates });
      }
    } catch (err) {
      untouched++;
      console.error(`! ${expense.id.slice(0, 8)}…  falha:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(
    `\nPromovidas a SUBMETIDA (QR): ${promoted} | pré-preenchidas por OCR: ${enriched} | sem alteração: ${untouched}`,
  );
  if (enriched + promoted === 0 && untouched > 0) {
    console.log('Dica: instala o OCR com `brew install tesseract tesseract-lang` e volta a correr.');
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
