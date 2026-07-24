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
import { heuristicFieldsFromOcrText } from '../src/services/ocr.service';

const OWNER_EMAIL = 'faturas.rag.hr@gmail.com';
const APPLY = process.argv.includes('--apply');
const execFileAsync = promisify(execFile);

// Fallbacks com o Vision da Apple (scripts/decode-qr.swift) — o mesmo motor do
// iPhone: modo 'qr' lê códigos que o jsQR falha em fotos recomprimidas; modo
// 'text' faz OCR de qualidade muito superior ao tesseract em fotos de talões.
async function runVision(buffer: Buffer, mode: 'qr' | 'text'): Promise<string | null> {
  const tmpPath = path.join(os.tmpdir(), `qr-${crypto.randomUUID()}.img`);
  fs.writeFileSync(tmpPath, buffer);
  try {
    const args = [path.join(__dirname, 'decode-qr.swift'), tmpPath];
    if (mode === 'text') args.push('--text');
    const { stdout } = await execFileAsync('swift', args, { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    const output = stdout.trim();
    return output.length > 0 ? output : null;
  } catch {
    return null; // swift indisponível ou sem resultados — segue sem Vision
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
      // Script local, sem timeout de cliente HTTP a pressionar — orçamento
      // generoso para o OCR multilingue ter hipótese em documentos difíceis.
      const ingest = await ingestDocument(buffer, detectFileMimeType(buffer), { ocrTimeoutMs: 120_000 });
      let parsedQr: ParsedInvoiceQr | null = ingest.parsedQr;
      let qrText = ingest.qrText;
      const ocrFields = ingest.ocrFields;
      let viaVision = false;
      let usedVisionOcr = false;

      if (!parsedQr) {
        const visionPayload = await runVision(buffer, 'qr');
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
      } else {
        // Sem QR: tenta os campos do OCR (tesseract, já corrido pelo
        // ingestDocument); se não deu nada, recorre ao OCR do Vision — texto
        // muito mais fiável em fotos — e passa-o pelas mesmas heurísticas.
        let fields = ocrFields ?? {};
        if (Object.keys(fields).length === 0) {
          const visionText = await runVision(buffer, 'text');
          if (visionText) {
            fields = heuristicFieldsFromOcrText(visionText);
            if (Object.keys(fields).length > 0) usedVisionOcr = true;
          }
        }
        if (!expense.supplierName && fields.supplierName) updates.supplierName = fields.supplierName;
        if (!expense.supplierNif && fields.issuerNif) updates.supplierNif = fields.issuerNif;
        if (!expense.acquirerNif && fields.acquirerNif) updates.acquirerNif = fields.acquirerNif;
        if (!expense.documentId && fields.documentId) updates.documentId = fields.documentId;
        if (!expense.documentDate && fields.documentDate) updates.documentDate = fields.documentDate;
        if (!expense.documentTime && fields.documentTime) updates.documentTime = fields.documentTime;
        if (expense.amountBase == null && fields.baseAmount != null) updates.amountBase = fields.baseAmount;
        if (expense.amountVat == null && fields.vatAmount != null) updates.amountVat = fields.vatAmount;
        if (expense.amountTotal == null && fields.totalAmount != null) updates.amountTotal = fields.totalAmount;
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
              : usedVisionOcr
                ? 'Vision OCR preencheu'
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
