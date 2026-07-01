import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { expensesRouter } from './routes/expenses';
import { reportsRouter } from './routes/reports';
import { authRouter } from './routes/auth';
import { requireAuth } from './middleware/require-auth';
import { startGmailPolling } from './services/gmail-poller.service';

const app = express();
const port = Number(process.env.PORT) || 4001;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/auth', authRouter);
app.use('/expenses', requireAuth, expensesRouter);
app.use('/reports', requireAuth, reportsRouter);

app.listen(port, () => {
  console.log(`[server] a correr em http://localhost:${port}`);
  startGmailPolling();
});
