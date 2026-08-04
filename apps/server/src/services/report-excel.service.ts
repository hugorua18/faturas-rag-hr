import ExcelJS from 'exceljs';
import { REPORT_STATUS_LABELS, type ExpenseCategory, type ReportStatus } from '@invoice-scanner/shared';
import type { ExpenseForReport } from './report-pdf.service';
import { categoryLabel, shouldShowVatDeductible, toCategoryMap, vatDeductibleLabel } from './report-category-labels';

// Folha "Resumo" (primeira do livro): por mês × tipo de despesa — nº de
// documentos, base (sem IVA), IVA e total (com IVA), com linha de totais.
// Coluna "IVA Dedutível" só aparece quando a conta tem a classificação ativa
// (ver report-category-labels.ts). Com ela ativa, agrupa também por essa
// classificação — cada fatura tem a sua própria (Expense.vatDeductible), por
// isso um mês+tipo pode ter faturas com valores diferentes.
function addSummarySheet(
  workbook: ExcelJS.Workbook,
  expenses: ExpenseForReport[],
  categories: ExpenseCategory[],
  showVat: boolean,
): void {
  const sheet = workbook.addWorksheet('Resumo');
  const categoryMap = toCategoryMap(categories);

  const groups = new Map<
    string,
    { count: number; base: number; vat: number; total: number; vatDeductible: boolean | null }
  >();
  for (const e of expenses) {
    const month = e.documentDate ? e.documentDate.slice(0, 7) : 'Sem data';
    const vatDeductible = e.vatDeductible ?? null;
    const key = showVat ? `${month}|${e.type}|${String(vatDeductible)}` : `${month}|${e.type}`;
    const entry = groups.get(key) ?? { count: 0, base: 0, vat: 0, total: 0, vatDeductible };
    entry.count += 1;
    entry.base += e.amountBase ?? 0;
    entry.vat += e.amountVat ?? 0;
    entry.total += e.amountTotal ?? 0;
    groups.set(key, entry);
  }
  const rows = Array.from(groups.entries())
    .map(([key, stats]) => {
      const [month, type] = key.split('|');
      return { month, type, ...stats };
    })
    .sort((a, b) => a.month.localeCompare(b.month) || a.type.localeCompare(b.type));

  const headers = ['Mês', 'Tipo de despesa', 'Documentos', 'Base (s/ IVA)', 'IVA', 'Total (c/ IVA)'];
  if (showVat) headers.push('IVA Dedutível');
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true };
  for (const r of rows) {
    const row: (string | number)[] = [r.month, categoryLabel(categoryMap, r.type), r.count, r.base, r.vat, r.total];
    if (showVat) row.push(vatDeductibleLabel(r.vatDeductible));
    sheet.addRow(row);
  }
  const totalRowValues: (string | number)[] = [
    'Total',
    '',
    rows.reduce((sum, r) => sum + r.count, 0),
    rows.reduce((sum, r) => sum + r.base, 0),
    rows.reduce((sum, r) => sum + r.vat, 0),
    rows.reduce((sum, r) => sum + r.total, 0),
  ];
  if (showVat) totalRowValues.push('');
  const totalRow = sheet.addRow(totalRowValues);
  totalRow.font = { bold: true };

  if (showVat) {
    const deductible = expenses.reduce((sum, e) => (e.vatDeductible === true ? sum + (e.amountVat ?? 0) : sum), 0);
    const nonDeductible = expenses.reduce((sum, e) => (e.vatDeductible === false ? sum + (e.amountVat ?? 0) : sum), 0);
    sheet.addRow([]);
    sheet.addRow(['IVA dedutível', deductible]);
    sheet.addRow(['IVA não dedutível', nonDeductible]);
  }

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
  categories: ExpenseCategory[] = [],
  vatClassificationEnabled = false,
): Promise<Buffer> {
  const showVat = shouldShowVatDeductible(vatClassificationEnabled);
  const workbook = new ExcelJS.Workbook();
  addSummarySheet(workbook, expenses, categories, showVat);
  const sheet = workbook.addWorksheet('Despesas');
  const categoryMap = toCategoryMap(categories);

  sheet.addRow(['NIF adquirente', acquirerNifLabel]);
  sheet.addRow(['Período', periodLabel]);
  if (status) sheet.addRow(['Estado', REPORT_STATUS_LABELS[status]]);
  sheet.addRow([]);

  const headers = ['Fornecedor', 'NIF fornecedor', 'Tipo de despesa', 'Nº documento', 'Data', 'Base', 'IVA', 'Total'];
  if (showVat) headers.push('IVA Dedutível');
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true };

  for (const expense of expenses) {
    const row: (string | number)[] = [
      expense.supplierName || '',
      expense.supplierNif || '',
      categoryLabel(categoryMap, expense.type),
      expense.documentId || '',
      expense.documentDate || '',
      expense.amountBase ?? 0,
      expense.amountVat ?? 0,
      expense.amountTotal ?? 0,
    ];
    if (showVat) row.push(vatDeductibleLabel(expense.vatDeductible));
    sheet.addRow(row);
  }

  const totalRowValues: (string | number)[] = [
    'Total',
    '',
    '',
    '',
    '',
    expenses.reduce((sum, e) => sum + (e.amountBase ?? 0), 0),
    expenses.reduce((sum, e) => sum + (e.amountVat ?? 0), 0),
    expenses.reduce((sum, e) => sum + (e.amountTotal ?? 0), 0),
  ];
  if (showVat) totalRowValues.push('');
  const totalRow = sheet.addRow(totalRowValues);
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
