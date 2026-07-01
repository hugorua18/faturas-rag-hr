import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { isExpenseType, isExpenseStatus, isReportStatus, isCurrencyCode, NO_NIF_KEY, NO_DATE_KEY } from '@invoice-scanner/shared';
import { prisma } from '../db/prisma';
import { ingestDocument } from '../services/document-ingest.service';

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

const VALID_SOURCES = ['CAMERA', 'EMAIL', 'UPLOAD'];

export const expensesRouter = Router();

function toOptionalFloat(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nifFilterValue(nifParam: string): string | null {
  return nifParam === NO_NIF_KEY ? null : nifParam;
}

function deleteUploadedFile(originalFilePath: string | null | undefined): void {
  if (!originalFilePath) return;
  const absolutePath = path.join(uploadsDir, '..', originalFilePath);
  fs.rm(absolutePath, { force: true }, () => {
    // Falha a apagar o ficheiro não deve impedir a operação na BD (ex: já não existe).
  });
}

expensesRouter.get('/', async (req, res) => {
  const { acquirerNif, period, status } = req.query as { acquirerNif?: string; period?: string; status?: string };
  const where: Record<string, unknown> = {
    userId: req.user!.id,
    status: status && isExpenseStatus(status) ? status : 'SUBMETIDA',
  };
  if (acquirerNif) where.acquirerNif = nifFilterValue(acquirerNif);
  if (period === NO_DATE_KEY) {
    where.documentDate = null;
  } else if (period) {
    where.documentDate = { startsWith: period };
  }
  const expenses = await prisma.expense.findMany({ where, orderBy: { documentDate: 'desc' } });
  res.json(expenses);
});

// Extrai o QR (e guarda uma imagem apresentável) de um PDF/imagem escolhido pelo
// utilizador — não cria despesa, só prepara os dados para o ecrã de validação
// (o mesmo papel que a câmara tem antes de ir para /validation).
expensesRouter.post('/extract', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Nenhum ficheiro enviado' });
    return;
  }
  try {
    const fileBuffer = fs.readFileSync(req.file.path);
    const { parsedQr, qrText, imageBuffer, imageMimeType } = await ingestDocument(fileBuffer, req.file.mimetype);
    deleteUploadedFile(`uploads/${req.file.filename}`);

    const ext = imageMimeType === 'image/png' ? '.png' : '.jpg';
    const filename = `${crypto.randomUUID()}${ext}`;
    fs.writeFileSync(path.join(uploadsDir, filename), imageBuffer);

    res.json({ parsedQr, qrRawPayload: qrText, originalFilePath: `uploads/${filename}`, fileMimeType: imageMimeType });
  } catch (err) {
    deleteUploadedFile(`uploads/${req.file.filename}`);
    res.status(400).json({ error: err instanceof Error ? err.message : 'Falha ao processar o ficheiro' });
  }
});

// Agregação por NIF adquirente — base do ecrã de relatórios (NIF -> meses -> despesas).
// Registado antes de "/:id" para o Express não interpretar "summary" como um id.
expensesRouter.get('/summary/nifs', async (req, res) => {
  const expenses = await prisma.expense.findMany({ where: { userId: req.user!.id, status: 'SUBMETIDA' } });
  const groups = new Map<string, { documentCount: number; totalAmount: number }>();
  for (const expense of expenses) {
    const key = expense.acquirerNif || NO_NIF_KEY;
    const entry = groups.get(key) ?? { documentCount: 0, totalAmount: 0 };
    entry.documentCount += 1;
    entry.totalAmount += expense.amountTotal ?? 0;
    groups.set(key, entry);
  }
  const result = Array.from(groups.entries())
    .map(([acquirerNif, stats]) => ({ acquirerNif, ...stats }))
    .sort((a, b) => b.totalAmount - a.totalAmount);
  res.json(result);
});

expensesRouter.get('/summary/nifs/:nif/months', async (req, res) => {
  const expenses = await prisma.expense.findMany({
    where: { userId: req.user!.id, status: 'SUBMETIDA', acquirerNif: nifFilterValue(req.params.nif) },
  });
  const groups = new Map<string, { documentCount: number; totalAmount: number }>();
  for (const expense of expenses) {
    const key = expense.documentDate ? expense.documentDate.slice(0, 7) : NO_DATE_KEY;
    const entry = groups.get(key) ?? { documentCount: 0, totalAmount: 0 };
    entry.documentCount += 1;
    entry.totalAmount += expense.amountTotal ?? 0;
    groups.set(key, entry);
  }
  const statuses = await prisma.monthlyReportStatus.findMany({
    where: { userId: req.user!.id, acquirerNif: req.params.nif },
  });
  const statusByPeriod = new Map(statuses.map((s) => [s.period, s.status]));
  const result = Array.from(groups.entries())
    .map(([period, stats]) => ({ period, ...stats, status: statusByPeriod.get(period) ?? 'ABERTO' }))
    .sort((a, b) => b.period.localeCompare(a.period));
  res.json(result);
});

// Ler/atualizar o estado (Aberto | Enviado para contabilista) de um mês de um NIF adquirente.
// acquirerNif/period guardam o valor literal do URL (incluindo sentinelas NO_NIF_KEY/NO_DATE_KEY),
// para corresponder exatamente às chaves usadas na agregação acima.
expensesRouter.put('/summary/nifs/:nif/months/:period/status', async (req, res) => {
  const { status } = req.body as { status?: string };
  if (!status || !isReportStatus(status)) {
    res.status(400).json({ error: 'Estado inválido' });
    return;
  }
  const record = await prisma.monthlyReportStatus.upsert({
    where: {
      userId_acquirerNif_period: { userId: req.user!.id, acquirerNif: req.params.nif, period: req.params.period },
    },
    create: { userId: req.user!.id, acquirerNif: req.params.nif, period: req.params.period, status },
    update: { status },
  });
  res.json({ period: record.period, status: record.status });
});

expensesRouter.get('/:id', async (req, res) => {
  const expense = await prisma.expense.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
  if (!expense) {
    res.status(404).json({ error: 'Despesa não encontrada' });
    return;
  }
  res.json(expense);
});

expensesRouter.post('/', upload.single('file'), async (req, res) => {
  const body = req.body as Record<string, string>;

  if (!body.type || !isExpenseType(body.type)) {
    res.status(400).json({ error: 'Tipo de despesa inválido' });
    return;
  }
  const source = body.source ?? 'CAMERA';
  if (!VALID_SOURCES.includes(source)) {
    res.status(400).json({ error: 'Origem inválida' });
    return;
  }
  if (body.currency && !isCurrencyCode(body.currency)) {
    res.status(400).json({ error: 'Moeda inválida' });
    return;
  }

  // Deteção de duplicados: mesmo fornecedor (NIF) + mesmo nº de documento já
  // submetido antes. Só é possível verificar quando ambos os campos estão
  // preenchidos (ex: faturas sem QR, inseridas à mão, podem não ter nº de
  // documento). O cliente confirma explicitamente a substituição enviando
  // "replaceExpenseId" — só nesse caso o registo antigo é apagado.
  const replaceExpenseId = body.replaceExpenseId || undefined;
  if (body.supplierNif && body.documentId && !replaceExpenseId) {
    const duplicate = await prisma.expense.findFirst({
      where: { userId: req.user!.id, status: 'SUBMETIDA', supplierNif: body.supplierNif, documentId: body.documentId },
    });
    if (duplicate) {
      res.status(409).json({
        error: 'Já existe uma despesa deste fornecedor com o mesmo número de documento.',
        existingId: duplicate.id,
      });
      return;
    }
  }

  if (replaceExpenseId) {
    const existing = await prisma.expense.findFirst({ where: { id: replaceExpenseId, userId: req.user!.id } });
    if (existing) {
      deleteUploadedFile(existing.originalFilePath);
      await prisma.expense.delete({ where: { id: replaceExpenseId } });
    }
  }

  const expense = await prisma.expense.create({
    data: {
      userId: req.user!.id,
      status: 'SUBMETIDA',
      source,
      type: body.type,
      supplierName: body.supplierName || undefined,
      supplierNif: body.supplierNif || undefined,
      acquirerNif: body.acquirerNif || undefined,
      documentType: body.documentType || undefined,
      documentId: body.documentId || undefined,
      documentDate: body.documentDate || undefined,
      documentTime: body.documentTime || undefined,
      amountBase: toOptionalFloat(body.amountBase),
      amountVat: toOptionalFloat(body.amountVat),
      amountTotal: toOptionalFloat(body.amountTotal),
      currency: body.currency || 'EUR',
      originalAmountBase: toOptionalFloat(body.originalAmountBase),
      originalAmountVat: toOptionalFloat(body.originalAmountVat),
      originalAmountTotal: toOptionalFloat(body.originalAmountTotal),
      qrRawPayload: body.qrRawPayload || undefined,
      // Upload manual/email já processado por /expenses/extract ou pelo poller do
      // Gmail — o ficheiro já está em uploads/, não é preciso reenviar os bytes.
      originalFilePath: req.file ? `uploads/${req.file.filename}` : body.existingFilePath || undefined,
    },
  });

  res.status(201).json(expense);
});

expensesRouter.patch('/:id', async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (body.type !== undefined && !isExpenseType(String(body.type))) {
    res.status(400).json({ error: 'Tipo de despesa inválido' });
    return;
  }
  if (body.status !== undefined && !isExpenseStatus(String(body.status))) {
    res.status(400).json({ error: 'Estado inválido' });
    return;
  }
  if (body.currency !== undefined && !isCurrencyCode(String(body.currency))) {
    res.status(400).json({ error: 'Moeda inválida' });
    return;
  }

  try {
    const existing = await prisma.expense.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!existing) {
      res.status(404).json({ error: 'Despesa não encontrada' });
      return;
    }
    const expense = await prisma.expense.update({
      where: { id: req.params.id },
      data: {
        status: body.status as string | undefined,
        type: body.type as string | undefined,
        supplierName: body.supplierName as string | undefined,
        supplierNif: body.supplierNif as string | undefined,
        acquirerNif: body.acquirerNif as string | undefined,
        documentType: body.documentType as string | undefined,
        documentId: body.documentId as string | undefined,
        documentDate: body.documentDate as string | undefined,
        documentTime: body.documentTime as string | undefined,
        amountBase: toOptionalFloat(body.amountBase),
        amountVat: toOptionalFloat(body.amountVat),
        amountTotal: toOptionalFloat(body.amountTotal),
        currency: body.currency as string | undefined,
        // Voltar a EUR limpa os valores na moeda original — deixam de fazer sentido.
        originalAmountBase: body.currency === 'EUR' ? null : toOptionalFloat(body.originalAmountBase),
        originalAmountVat: body.currency === 'EUR' ? null : toOptionalFloat(body.originalAmountVat),
        originalAmountTotal: body.currency === 'EUR' ? null : toOptionalFloat(body.originalAmountTotal),
      },
    });
    res.json(expense);
  } catch {
    res.status(404).json({ error: 'Despesa não encontrada' });
  }
});

expensesRouter.delete('/:id', async (req, res) => {
  try {
    const existing = await prisma.expense.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!existing) {
      res.status(404).json({ error: 'Despesa não encontrada' });
      return;
    }
    const expense = await prisma.expense.delete({ where: { id: req.params.id } });
    deleteUploadedFile(expense.originalFilePath);
    res.status(204).send();
  } catch {
    res.status(404).json({ error: 'Despesa não encontrada' });
  }
});
