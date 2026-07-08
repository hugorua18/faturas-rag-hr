import fs from 'node:fs';
import pdfMake from 'pdfmake';
import type { Content } from 'pdfmake/interfaces';
import { EXPENSE_TYPE_LABELS, REPORT_STATUS_LABELS, type ExpenseType, type ReportStatus } from '@invoice-scanner/shared';
import { resolveSafeUploadPath } from '../utils/uploads-path';
import { fetchDriveFileBuffer } from './drive.service';

export interface ReportUser {
  googleRefreshTokenEnc: string | null;
  googleAuthClientId: string | null;
}

export interface ExpenseForReport {
  id: string;
  driveFileId: string | null;
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

function isJpeg(buffer: Buffer): boolean {
  return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isPng(buffer: Buffer): boolean {
  return buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

// Ficheiros corrompidos/vazios (ex: capturas de teste falhadas) não têm um cabeçalho
// de imagem válido — o pdfmake só deteta isto ao gerar o documento e aborta o PDF
// inteiro, por isso validamos aqui e tratamos como "sem imagem" em vez de rebentar.
function bufferToDataUrl(buffer: Buffer): string | undefined {
  if (isPng(buffer)) return `data:image/png;base64,${buffer.toString('base64')}`;
  if (isJpeg(buffer)) return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  return undefined;
}

// Ficheiro local primeiro; quando já não existe (o disco do Render free é
// efémero — cada deploy limpa uploads/), recua para a cópia arquivada no
// Google Drive do utilizador. Sem imagem em nenhum dos sítios → "Sem imagem".
async function readImageAsDataUrl(expense: ExpenseForReport, user: ReportUser | null): Promise<string | undefined> {
  const absolutePath = resolveSafeUploadPath(expense.originalFilePath);
  if (absolutePath) {
    try {
      const dataUrl = bufferToDataUrl(fs.readFileSync(absolutePath));
      if (dataUrl) return dataUrl;
    } catch {
      // cai para o Drive
    }
  }
  if (expense.driveFileId && user?.googleRefreshTokenEnc) {
    try {
      return bufferToDataUrl(await fetchDriveFileBuffer(user, expense.driveFileId));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// Resumo pedido pelo utilizador: por mês (e ano) × tipo de despesa — nº de
// documentos, base (sem IVA), IVA e total (com IVA). Aparece no início do
// relatório, antes do detalhe documento a documento.
function buildSummaryContent(expenses: ExpenseForReport[]): Content[] {
  if (expenses.length === 0) return [];

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

  const totals = rows.reduce(
    (acc, r) => ({ count: acc.count + r.count, base: acc.base + r.base, vat: acc.vat + r.vat, total: acc.total + r.total }),
    { count: 0, base: 0, vat: 0, total: 0 },
  );

  const headerCells = ['Mês', 'Tipo', 'Documentos', 'Base (s/ IVA)', 'IVA', 'Total (c/ IVA)'].map((text) => ({
    text,
    bold: true,
    fillColor: '#f0f0f0',
  }));

  return [
    { text: 'Resumo', style: 'sectionTitle' },
    {
      table: {
        headerRows: 1,
        widths: ['auto', '*', 'auto', 'auto', 'auto', 'auto'],
        body: [
          headerCells,
          ...rows.map((r) => [
            r.month,
            EXPENSE_TYPE_LABELS[r.type] ?? r.type,
            { text: String(r.count), alignment: 'right' },
            { text: currency(r.base), alignment: 'right' },
            { text: currency(r.vat), alignment: 'right' },
            { text: currency(r.total), alignment: 'right' },
          ]),
          [
            { text: 'Total', bold: true },
            '',
            { text: String(totals.count), alignment: 'right', bold: true },
            { text: currency(totals.base), alignment: 'right', bold: true },
            { text: currency(totals.vat), alignment: 'right', bold: true },
            { text: currency(totals.total), alignment: 'right', bold: true },
          ],
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 0, 0, 20],
    } as Content,
  ];
}

function currency(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
}

export async function buildMonthlyReportPdf(
  acquirerNifLabel: string,
  periodLabel: string,
  status: ReportStatus | null,
  expenses: ExpenseForReport[],
  user: ReportUser | null = null,
): Promise<Buffer> {
  const total = expenses.reduce((sum, e) => sum + (e.amountTotal ?? 0), 0);

  const content: Content[] = [
    { text: 'Relatório de despesas', style: 'title' },
    { text: `NIF adquirente: ${acquirerNifLabel}`, style: 'subtitle' },
    { text: `Período: ${periodLabel}`, style: 'subtitle' },
    ...(status ? [{ text: `Estado: ${REPORT_STATUS_LABELS[status]}`, style: 'subtitle' }] : []),
    { text: `Total: ${currency(total)} · ${expenses.length} documento(s)`, style: 'subtitle', margin: [0, 0, 0, 16] },
    ...buildSummaryContent(expenses),
    ...(expenses.length > 0 ? [{ text: 'Documentos', style: 'sectionTitle' } as Content] : []),
  ];

  for (const expense of expenses) {
    const dataUrl = await readImageAsDataUrl(expense, user);
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
        sectionTitle: { fontSize: 14, bold: true, margin: [0, 8, 0, 8] },
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
