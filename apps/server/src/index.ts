import express from 'express';
import cors from 'cors';
import { expensesRouter } from './routes/expenses';
import { reportsRouter } from './routes/reports';
import { suppliersRouter } from './routes/suppliers';
import { authRouter } from './routes/auth';
import { requireAuth } from './middleware/require-auth';
import { startGmailPolling } from './services/gmail-poller.service';
import { prisma } from './db/prisma';
import { resolveSafeUploadPath, verifyUploadSignature } from './utils/uploads-path';

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
});
