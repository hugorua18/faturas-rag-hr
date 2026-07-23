import express from 'express';
import cors from 'cors';
import { expensesRouter } from './routes/expenses';
import { reportsRouter } from './routes/reports';
import { suppliersRouter } from './routes/suppliers';
import { authRouter } from './routes/auth';
import { requireAuth } from './middleware/require-auth';
import { startGmailPolling } from './services/gmail-poller.service';
import { startSheetsExport } from './services/sheets-export.service';
import { prisma } from './db/prisma';
import fs from 'node:fs';
import { resolveSafeUploadPath, verifyUploadSignature, verifyExpenseFileSignature } from './utils/uploads-path';
import { fetchDriveFileBuffer, detectFileMimeType } from './services/drive.service';

const app = express();
const port = Number(process.env.PORT) || 4001;

// Sem lista de origens confiáveis, app.use(cors()) reflete/permite qualquer
// origem — remove uma camada de defesa. A app nativa (iOS/Android) não envia
// header Origin, por isso não é afetada por esta lista.
const ALLOWED_ORIGINS = new Set(['http://localhost:8081', 'https://invoice-scanner.expo.app']);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || ALLOWED_ORIGINS.has(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
  }),
);
app.use(express.json());

// As imagens/PDFs de faturas só são servidos com uma URL assinada de curta
// duração (ver utils/uploads-path.ts) — nunca por express.static sem
// autenticação, o que daria acesso permanente e não-revogável a documentos
// com NIF/valores a qualquer pessoa com o link (ex: vazado em logs, histórico
// do browser, um relatório partilhado).
app.get('/uploads/:filename', (req, res) => {
  const { exp, sig } = req.query as { exp?: string; sig?: string };
  const originalFilePath = `uploads/${req.params.filename}`;
  if (!exp || !sig || !verifyUploadSignature(originalFilePath, exp, sig)) {
    res.status(403).json({ error: 'Link inválido ou expirado' });
    return;
  }
  const absolutePath = resolveSafeUploadPath(originalFilePath);
  if (!absolutePath) {
    res.status(404).end();
    return;
  }
  res.sendFile(absolutePath);
});

// Ficheiro original de uma despesa, com URL assinada de curta duração (ver
// signExpenseFileUrl): serve o ficheiro local se ainda existir e recua para a
// cópia arquivada no Google Drive — o disco do Render free é efémero e cada
// deploy limpa uploads/, mas o Drive guarda o original para sempre.
// Registado ANTES do router autenticado de /expenses: o acesso é validado
// pela assinatura (as URLs são gerador por rotas já autenticadas), porque
// <img>/<Image> não conseguem enviar headers Authorization em todas as plataformas.
app.get('/expenses/:id/file', async (req, res) => {
  const { exp, sig } = req.query as { exp?: string; sig?: string };
  if (!exp || !sig || !verifyExpenseFileSignature(req.params.id, exp, sig)) {
    res.status(403).json({ error: 'Link inválido ou expirado' });
    return;
  }
  try {
    const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!expense) {
      res.status(404).json({ error: 'Despesa não encontrada' });
      return;
    }
    const absolutePath = resolveSafeUploadPath(expense.originalFilePath);
    if (absolutePath && fs.existsSync(absolutePath)) {
      res.sendFile(absolutePath);
      return;
    }
    if (expense.driveFileId && expense.userId) {
      const user = await prisma.user.findUnique({ where: { id: expense.userId } });
      if (user?.googleRefreshTokenEnc) {
        const buffer = await fetchDriveFileBuffer(user, expense.driveFileId);
        res.setHeader('Content-Type', detectFileMimeType(buffer));
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.send(buffer);
        return;
      }
    }
    res.status(404).json({ error: 'O ficheiro original já não está disponível' });
  } catch (err) {
    console.error(`[expenses] falha a servir o ficheiro da despesa ${req.params.id}`, err);
    res.status(502).json({ error: 'Falha ao obter o ficheiro' });
  }
});

// Toca na BD (não só no processo) para que o ping externo de keep-alive
// (.github/workflows/keep-alive.yml) evite tanto o spin-down do serviço no
// Render como a suspensão do compute do Neon por inatividade.
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch (err) {
    console.error('[health] falha ao contactar a base de dados', err);
    res.status(503).json({ ok: false });
  }
});
app.use('/auth', authRouter);
app.use('/expenses', requireAuth, expensesRouter);
app.use('/reports', requireAuth, reportsRouter);
app.use('/suppliers', requireAuth, suppliersRouter);

// Apanha erros do multer (ex: fileFilter a rejeitar um tipo de ficheiro não
// suportado) e do CORS, devolvendo um JSON limpo em vez do handler por
// omissão do Express (que pode devolver stack traces).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err.message);
  res.status(400).json({ error: err.message || 'Pedido inválido' });
});

app.listen(port, () => {
  console.log(`[server] a correr em http://localhost:${port}`);
  startGmailPolling();
  startSheetsExport();
});
