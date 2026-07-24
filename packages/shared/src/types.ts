import type { ExpenseType } from './expense-types';

export type ExpenseStatus = 'TRATAMENTO_MANUAL' | 'SUBMETIDA';
export type ExpenseSource = 'CAMERA' | 'EMAIL' | 'UPLOAD';

export function isExpenseStatus(value: string): value is ExpenseStatus {
  return value === 'TRATAMENTO_MANUAL' || value === 'SUBMETIDA';
}

// Lista de atalhos comuns para o seletor — não é exaustiva, o utilizador pode
// escrever qualquer código de 3 letras (estilo ISO 4217) que não esteja aqui.
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'BRL'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const CURRENCY_LABELS: Record<Currency, string> = {
  EUR: 'EUR (€)',
  USD: 'USD ($)',
  GBP: 'GBP (£)',
  CHF: 'CHF',
  BRL: 'BRL (R$)',
};

/** Aceita qualquer código de moeda de 3 letras maiúsculas, não só os da lista de atalhos. */
export function isCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

/** Payload enviado pelo cliente ao submeter/criar uma despesa, depois de validado pelo utilizador. */
export interface ExpenseInput {
  type: ExpenseType;
  supplierName?: string;
  supplierNif?: string;
  acquirerNif?: string;
  documentType?: string;
  /** Nº do documento (campo G do QR, ex: "FS HOS/3980") — usado para detetar duplicados por fornecedor. */
  documentId?: string;
  /** ISO date (YYYY-MM-DD). */
  documentDate?: string;
  /** HH:MM — o standard QR não traz hora, vem de OCR ou introdução manual. */
  documentTime?: string;
  /** Sempre em EUR — é o que entra nos relatórios/somas. Quando a moeda original não é EUR,
   * estes valores são calculados a partir de originalAmount* + o total em EUR introduzido. */
  amountBase?: number;
  amountVat?: number;
  amountTotal?: number;
  /** Moeda da fatura original (default "EUR"). Código de 3 letras, não limitado à lista CURRENCIES. */
  currency?: string;
  /** Valores na moeda original — só relevantes quando currency !== "EUR". */
  originalAmountBase?: number;
  originalAmountVat?: number;
  originalAmountTotal?: number;
  qrRawPayload?: string;
  source: ExpenseSource;
}

export interface Expense extends ExpenseInput {
  id: string;
  status: ExpenseStatus;
  /** Caminho relativo (Fase 0, disco local) ou, a partir da Fase 1, referência no Drive. */
  originalFilePath?: string;
  /** URL assinada de curta duração (~15min) para ver/descarregar originalFilePath — usar
   * esta em vez de construir a URL a partir de originalFilePath diretamente, que já não
   * é servido sem autenticação. Pode ser null se não houver ficheiro. */
  fileUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Sentinela usado nos endpoints de agregação/filtro quando não há NIF adquirente ou data. */
export const NO_NIF_KEY = 'sem-nif';
export const NO_DATE_KEY = 'sem-data';

/**
 * Conta Google da caixa de ingestão de faturas por email. Fonte única para
 * servidor (dono das despesas/EMAIL, ver gmail-poller.service.ts) e app
 * (mostra o envelope só a esta conta, ver hooks/use-email-feature.ts) —
 * manter os dois lados a ler daqui evita divergência silenciosa.
 */
export const EMAIL_INGEST_ACCOUNT = 'faturas.rag.hr@gmail.com';

/** Um NIF adquirente + totais agregados de todas as despesas SUBMETIDA desse NIF. */
export interface AcquirerNifSummary {
  acquirerNif: string;
  documentCount: number;
  totalAmount: number;
}

export type ReportStatus = 'ABERTO' | 'ENVIADO_CONTABILISTA';

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  ABERTO: 'Aberto',
  ENVIADO_CONTABILISTA: 'Enviado para contabilista',
};

export const REPORT_STATUS_COLORS: Record<ReportStatus, string> = {
  ABERTO: '#F5A623',
  ENVIADO_CONTABILISTA: '#34C759',
};

export function isReportStatus(value: string): value is ReportStatus {
  return value === 'ABERTO' || value === 'ENVIADO_CONTABILISTA';
}

/** Um mês (formato "AAAA-MM") + totais agregados, para um NIF adquirente específico. */
export interface MonthlySummary {
  period: string;
  documentCount: number;
  totalAmount: number;
  status: ReportStatus;
}

/** Corpo da resposta 409 quando já existe uma despesa com o mesmo NIF do prestador + nº de documento. */
export interface DuplicateExpenseResponse {
  error: string;
  existingId: string;
}
