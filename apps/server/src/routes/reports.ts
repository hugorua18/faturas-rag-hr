import { Router } from 'express';
import { NO_DATE_KEY, NO_NIF_KEY, type ExpenseType } from '@invoice-scanner/shared';
import { prisma } from '../db/prisma';
import { buildMonthlyReportPdf, type ExpenseForReport } from '../services/report-pdf.service';
import { buildMonthlyReportExcel } from '../services/report-excel.service';

export const reportsRouter = Router();

function nifFilterValue(nifParam: string): string | null {
  return nifParam === NO_NIF_KEY ? null : nifParam;
}

async function loadMonthlyReportData(userId: string, nifParam: string, periodParam: string) {
  const acquirerNif = nifFilterValue(nifParam);
  const expenses = await prisma.expense.findMany({
    where: {
      userId,
      status: 'SUBMETIDA',
      acquirerNif,
      documentDate: periodParam === NO_DATE_KEY ? null : { startsWith: periodParam },
    },
    orderBy: { documentDate: 'desc' },
  });
  const statusRecord = await prisma.monthlyReportStatus.findUnique({
    where: { userId_acquirerNif_period: { userId, acquirerNif: nifParam, period: periodParam } },
  });
  return {
    expenses: expenses.map((e) => ({ ...e, type: e.type as ExpenseType })) satisfies ExpenseForReport[],
    status: (statusRecord?.status as 'ABERTO' | 'ENVIADO_CONTABILISTA') ?? 'ABERTO',
  };
}

// Relatório personalizado: intervalo de meses (ex: "2026-06" a "2026-08"), sem
// estado (esse conceito só existe por mês individual). Comparação lexicográfica
// de strings ISO ("2026-06-01" <= documentDate <= "2026-08-31") é válida porque
// datas ISO ordenam-se corretamente como texto.
async function loadRangeReportData(userId: string, nifParam: string, fromPeriod: string, toPeriod: string) {
  const acquirerNif = nifFilterValue(nifParam);
  const expenses = await prisma.expense.findMany({
    where: {
      userId,
      status: 'SUBMETIDA',
      acquirerNif,
      documentDate: { gte: `${fromPeriod}-01`, lte: `${toPeriod}-31` },
    },
    orderBy: { documentDate: 'desc' },
  });
  return { expenses: expenses.map((e) => ({ ...e, type: e.type as ExpenseType })) satisfies ExpenseForReport[] };
}

reportsRouter.get('/:nif/:period/pdf', async (req, res) => {
  const { nif, period } = req.params;
  const label = typeof req.query.label === 'string' ? req.query.label : period;
  try {
    const { expenses, status } = await loadMonthlyReportData(req.user!.id, nif, period);
    const buffer = await buildMonthlyReportPdf(nif, label, status, expenses);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="relatorio-${nif}-${period}.pdf"`);
    res.send(buffer);
  } catch (err) {
    console.error('[reports] falha a gerar PDF', err);
    res.status(500).json({ error: 'Falha ao gerar o PDF do relatório' });
  }
});

reportsRouter.get('/:nif/:period/xlsx', async (req, res) => {
  const { nif, period } = req.params;
  const label = typeof req.query.label === 'string' ? req.query.label : period;
  try {
    const { expenses, status } = await loadMonthlyReportData(req.user!.id, nif, period);
    const buffer = await buildMonthlyReportExcel(nif, label, status, expenses);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="relatorio-${nif}-${period}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('[reports] falha a gerar Excel', err);
    res.status(500).json({ error: 'Falha ao gerar o Excel do relatório' });
  }
});

// Registados depois de "/:nif/:period/pdf|xlsx" — caminhos com menos segmentos
// ("/:nif/pdf" vs "/:nif/:period/pdf"), sem ambiguidade de rota no Express.
reportsRouter.get('/:nif/pdf', async (req, res) => {
  const { nif } = req.params;
  const { from, to, label } = req.query as { from?: string; to?: string; label?: string };
  if (!from || !to) {
    res.status(400).json({ error: 'Datas "from" e "to" são obrigatórias' });
    return;
  }
  try {
    const { expenses } = await loadRangeReportData(req.user!.id, nif, from, to);
    const buffer = await buildMonthlyReportPdf(nif, label || `${from} a ${to}`, null, expenses);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="relatorio-${nif}-${from}-a-${to}.pdf"`);
    res.send(buffer);
  } catch (err) {
    console.error('[reports] falha a gerar PDF personalizado', err);
    res.status(500).json({ error: 'Falha ao gerar o PDF do relatório' });
  }
});

reportsRouter.get('/:nif/xlsx', async (req, res) => {
  const { nif } = req.params;
  const { from, to, label } = req.query as { from?: string; to?: string; label?: string };
  if (!from || !to) {
    res.status(400).json({ error: 'Datas "from" e "to" são obrigatórias' });
    return;
  }
  try {
    const { expenses } = await loadRangeReportData(req.user!.id, nif, from, to);
    const buffer = await buildMonthlyReportExcel(nif, label || `${from} a ${to}`, null, expenses);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="relatorio-${nif}-${from}-a-${to}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('[reports] falha a gerar Excel personalizado', err);
    res.status(500).json({ error: 'Falha ao gerar o Excel do relatório' });
  }
});
