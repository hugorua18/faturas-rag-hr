import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { expensesRouter } from './routes/expenses';
import { reportsRouter } from './routes/reports';
import { authRouter } from './routes/auth';
import { requireAuth } from './middleware/require-auth';
import { startGmailPolling } from './services/gmail-poller.service';
import { prisma } from './db/prisma';

const app = express();
const port = Number(process.env.PORT) || 4001;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

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

app.listen(port, () => {
  console.log(`[server] a correr em http://localhost:${port}`);
  startGmailPolling();
});
