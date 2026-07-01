import ExcelJS from 'exceljs';
import { EXPENSE_TYPE_LABELS, REPORT_STATUS_LABELS, type ReportStatus } from '@invoice-scanner/shared';
import type { ExpenseForReport } from './report-pdf.service';

export async function buildMonthlyReportExcel(
  acquirerNifLabel: string,
  periodLabel: string,
  status: ReportStatus | null,
  expenses: ExpenseForReport[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
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
