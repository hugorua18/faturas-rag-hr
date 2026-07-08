import ExcelJS from 'exceljs';
import { EXPENSE_TYPE_LABELS, REPORT_STATUS_LABELS, type ExpenseType, type ReportStatus } from '@invoice-scanner/shared';
import type { ExpenseForReport } from './report-pdf.service';

// Folha "Resumo" (primeira do livro): por mês × tipo de despesa — nº de
// documentos, base (sem IVA), IVA e total (com IVA), com linha de totais.
function addSummarySheet(workbook: ExcelJS.Workbook, expenses: ExpenseForReport[]): void {
  const sheet = workbook.addWorksheet('Resumo');

  const groups = new Map<string, { count: number; base: number; vat: number; total: number }>();
  for (const e of expenses) {
    const month = e.documentDate ? e.documentDate.slice(0, 7) : 'Sem data';
    const key = `${month}|${e.type}`;
    const entry = groups.get(key) ?? { count: 0, base: 0, vat: 0, total: 0 };
    entry.count += 1;
    entry.base += e.amountBase ?? 0;
    entry.vat += e.amountVat ?? 0;
    entry.total += e.amountTotal ?? 0;
    groups.set(key, entry);
  }
  const rows = Array.from(groups.entries())
    .map(([key, stats]) => {
      const [month, type] = key.split('|');
      return { month, type: type as ExpenseType, ...stats };
    })
    .sort((a, b) => a.month.localeCompare(b.month) || a.type.localeCompare(b.type));

  const headerRow = sheet.addRow(['Mês', 'Tipo de despesa', 'Documentos', 'Base (s/ IVA)', 'IVA', 'Total (c/ IVA)']);
  headerRow.font = { bold: true };
  for (const r of rows) {
    sheet.addRow([r.month, EXPENSE_TYPE_LABELS[r.type] ?? r.type, r.count, r.base, r.vat, r.total]);
  }
  const totalRow = sheet.addRow([
    'Total',
    '',
    rows.reduce((sum, r) => sum + r.count, 0),
    rows.reduce((sum, r) => sum + r.base, 0),
    rows.reduce((sum, r) => sum + r.vat, 0),
    rows.reduce((sum, r) => sum + r.total, 0),
  ]);
  totalRow.font = { bold: true };

  sheet.columns.forEach((column) => {
    column.width = 20;
  });
  sheet.getColumn(4).numFmt = '#,##0.00 €';
  sheet.getColumn(5).numFmt = '#,##0.00 €';
  sheet.getColumn(6).numFmt = '#,##0.00 €';
}

export async function buildMonthlyReportExcel(
  acquirerNifLabel: string,
  periodLabel: string,
  status: ReportStatus | null,
  expenses: ExpenseForReport[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  addSummarySheet(workbook, expenses);
  const sheet = workbook.addWorksheet('Despesas');

  sheet.addRow(['NIF adquirente', acquirerNifLabel]);
  sheet.addRow(['Período', periodLabel]);
  if (status) sheet.addRow(['Estado', REPORT_STATUS_LABELS[status]]);
  sheet.addRow([]);

  const headerRow = sheet.addRow([
    'Fornecedor',
    'NIF fornecedor',
    'Tipo de despesa',
    'Nº documento',
    'Data',
    'Base',
    'IVA',
    'Total',
  ]);
  headerRow.font = { bold: true };

  for (const expense of expenses) {
    sheet.addRow([
      expense.supplierName || '',
      expense.supplierNif || '',
      EXPENSE_TYPE_LABELS[expense.type] ?? expense.type,
      expense.documentId || '',
      expense.documentDate || '',
      expense.amountBase ?? 0,
      expense.amountVat ?? 0,
      expense.amountTotal ?? 0,
    ]);
  }

  const totalRow = sheet.addRow([
    'Total',
    '',
    '',
    '',
    '',
    expenses.reduce((sum, e) => sum + (e.amountBase ?? 0), 0),
    expenses.reduce((sum, e) => sum + (e.amountVat ?? 0), 0),
    expenses.reduce((sum, e) => sum + (e.amountTotal ?? 0), 0),
  ]);
  totalRow.font = { bold: true };

  sheet.columns.forEach((column) => {
    column.width = 20;
  });
  sheet.getColumn(6).numFmt = '#,##0.00 €';
  sheet.getColumn(7).numFmt = '#,##0.00 €';
  sheet.getColumn(8).numFmt = '#,##0.00 €';

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
