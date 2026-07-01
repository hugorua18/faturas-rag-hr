import fs from 'node:fs';
import path from 'node:path';
import pdfMake from 'pdfmake';
import type { Content } from 'pdfmake/interfaces';
import { EXPENSE_TYPE_LABELS, REPORT_STATUS_LABELS, type ExpenseType, type ReportStatus } from '@invoice-scanner/shared';

export interface ExpenseForReport {
  type: ExpenseType;
  supplierName: string | null;
  supplierNif: string | null;
  documentId: string | null;
  documentDate: string | null;
  amountBase: number | null;
  amountVat: number | null;
  amountTotal: number | null;
  originalFilePath: string | null;
}

pdfMake.setFonts({ Helvetica: require('pdfmake/standard-fonts/Helvetica').Helvetica });

const uploadsRoot = path.join(__dirname, '..', '..');

function isJpeg(buffer: Buffer): boolean {
  return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isPng(buffer: Buffer): boolean {
  return buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

// Ficheiros corrompidos/vazios (ex: capturas de teste falhadas) não têm um cabeçalho
// de imagem válido — o pdfmake só deteta isto ao gerar o documento e aborta o PDF
// inteiro, por isso validamos aqui e tratamos como "sem imagem" em vez de rebentar.
function readImageAsDataUrl(originalFilePath: string | null): string | undefined {
  if (!originalFilePath) return undefined;
  try {
    const absolutePath = path.join(uploadsRoot, originalFilePath);
    const buffer = fs.readFileSync(absolutePath);
    if (isPng(buffer)) return `data:image/png;base64,${buffer.toString('base64')}`;
    if (isJpeg(buffer)) return `data:image/jpeg;base64,${buffer.toString('base64')}`;
    return undefined;
  } catch {
    return undefined;
  }
}

function currency(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
}

export async function buildMonthlyReportPdf(
  acquirerNifLabel: string,
  periodLabel: string,
  status: ReportStatus | null,
  expenses: ExpenseForReport[],
): Promise<Buffer> {
  const total = expenses.reduce((sum, e) => sum + (e.amountTotal ?? 0), 0);

  const content: Content[] = [
    { text: 'Relatório de despesas', style: 'title' },
    { text: `NIF adquirente: ${acquirerNifLabel}`, style: 'subtitle' },
    { text: `Período: ${periodLabel}`, style: 'subtitle' },
    ...(status ? [{ text: `Estado: ${REPORT_STATUS_LABELS[status]}`, style: 'subtitle' }] : []),
    { text: `Total: ${currency(total)} · ${expenses.length} documento(s)`, style: 'subtitle', margin: [0, 0, 0, 16] },
  ];

  for (const expense of expenses) {
    const dataUrl = readImageAsDataUrl(expense.originalFilePath ?? null);
    const details = [
      { text: expense.supplierName || 'Fornecedor não indicado', style: 'itemTitle' },
      {
        text: `${EXPENSE_TYPE_LABELS[expense.type] ?? expense.type} · ${expense.documentDate || 'sem data'}`,
        style: 'itemMeta',
      },
      expense.supplierNif ? { text: `NIF fornecedor: ${expense.supplierNif}`, style: 'itemMeta' } : null,
      expense.documentId ? { text: `Nº documento: ${expense.documentId}`, style: 'itemMeta' } : null,
      {
        text: `Base: ${currency(expense.amountBase)}   IVA: ${currency(expense.amountVat)}   Total: ${currency(expense.amountTotal)}`,
        style: 'itemAmounts',
      },
    ].filter(Boolean) as Content[];

    content.push({
      columns: [
        dataUrl
          ? { image: dataUrl, width: 110, height: 110, fit: [110, 110] }
          : { text: 'Sem imagem', width: 110, italics: true, color: '#999999' },
        { width: 16, text: '' },
        { width: '*', stack: details },
      ],
      margin: [0, 0, 0, 14],
    });
  }

  const doc = pdfMake.createPdf(
    {
      defaultStyle: { font: 'Helvetica', fontSize: 10 },
      pageMargins: [40, 40, 40, 40],
      content,
      styles: {
        title: { fontSize: 18, bold: true, margin: [0, 0, 0, 8] },
        subtitle: { fontSize: 11, color: '#555555' },
        itemTitle: { fontSize: 12, bold: true },
        itemMeta: { fontSize: 10, color: '#555555' },
        itemAmounts: { fontSize: 10, margin: [0, 4, 0, 0] },
      },
    },
    {},
  );

  return doc.getBuffer();
}
