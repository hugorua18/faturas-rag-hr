import { Platform } from 'react-native';
import { router } from 'expo-router';
import type {
  AcquirerNifSummary,
  DuplicateExpenseResponse,
  Expense,
  ExpenseInput,
  ExpenseStatus,
  MonthlySummary,
  ParsedInvoiceQr,
  ReportStatus,
} from '@invoice-scanner/shared';
import { API_BASE_URL } from './config';
import { clearSessionToken, getSessionToken } from '@/state/session';

export interface CapturedFile {
  uri: string;
  name: string;
  mimeType: string;
}

// Wrapper único para todos os pedidos ao backend — injeta o header
// "Authorization: Bearer <token>" a partir da sessão guardada (state/session.ts),
// para os endpoints /expenses e /reports, que exigem sessão (requireAuth). Rotas
// não autenticadas (ex: /auth/google/callback) também podem usar isto sem
// problema: sem token, o header simplesmente não é adicionado.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getSessionToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  // Sessão expirada (30 dias) ou revogada no servidor — sem isto, os ecrãs
  // ficavam presos a receber 401 para sempre, sem forma de voltar a autenticar.
  if (response.status === 401 && token) {
    await clearSessionToken();
    router.replace('/login');
  }
  return response;
}

export class DuplicateExpenseError extends Error {
  existingId: string;

  constructor(message: string, existingId: string) {
    super(message);
    this.name = 'DuplicateExpenseError';
    this.existingId = existingId;
  }
}

// Na Web, FormData só aceita um Blob/File real, por isso convertemos via
// fetch(uri).blob(). Em nativo, converter para blob primeiro pode falhar em
// silêncio para ficheiros maiores (produz um blob vazio sem erro) — o padrão
// correto em React Native é anexar diretamente {uri, name, type}, que o
// fetch/FormData nativo reconhece e transmite a partir do disco.
async function appendFileToFormData(formData: FormData, file: CapturedFile): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = await fetch(file.uri).then((r) => r.blob());
    formData.append('file', blob, file.name);
  } else {
    formData.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
  }
}

export async function createExpense(
  input: ExpenseInput,
  file?: CapturedFile,
  replaceExpenseId?: string,
  existingFilePath?: string,
): Promise<Expense> {
  const formData = new FormData();
  formData.append('type', input.type);
  formData.append('source', input.source);
  if (input.supplierName) formData.append('supplierName', input.supplierName);
  if (input.supplierNif) formData.append('supplierNif', input.supplierNif);
  if (input.acquirerNif) formData.append('acquirerNif', input.acquirerNif);
  if (input.documentType) formData.append('documentType', input.documentType);
  if (input.documentId) formData.append('documentId', input.documentId);
  if (input.documentDate) formData.append('documentDate', input.documentDate);
  if (input.documentTime) formData.append('documentTime', input.documentTime);
  if (input.amountBase !== undefined) formData.append('amountBase', String(input.amountBase));
  if (input.amountVat !== undefined) formData.append('amountVat', String(input.amountVat));
  if (input.amountTotal !== undefined) formData.append('amountTotal', String(input.amountTotal));
  if (input.qrRawPayload) formData.append('qrRawPayload', input.qrRawPayload);
  if (replaceExpenseId) formData.append('replaceExpenseId', replaceExpenseId);

  if (file) {
    await appendFileToFormData(formData, file);
  } else if (existingFilePath) {
    // Upload manual (via /expenses/extract) já gravou o ficheiro no servidor —
    // não faz sentido reenviar os bytes, só referenciar o caminho.
    formData.append('existingFilePath', existingFilePath);
  }

  const response = await apiFetch('/expenses', { method: 'POST', body: formData });
  if (response.status === 409) {
    const body: DuplicateExpenseResponse = await response.json();
    throw new DuplicateExpenseError(body.error, body.existingId);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Falha ao submeter despesa (${response.status})`);
  }
  return response.json();
}

export async function listExpenses(filter?: {
  acquirerNif?: string;
  period?: string;
  status?: ExpenseStatus;
}): Promise<Expense[]> {
  const params = new URLSearchParams();
  if (filter?.acquirerNif) params.set('acquirerNif', filter.acquirerNif);
  if (filter?.period) params.set('period', filter.period);
  if (filter?.status) params.set('status', filter.status);
  const query = params.toString();
  const response = await apiFetch(`/expenses${query ? `?${query}` : ''}`);
  if (!response.ok) throw new Error('Falha ao carregar despesas');
  return response.json();
}

// Nome do prestador a partir do NIF: histórico do próprio utilizador primeiro,
// depois o registo oficial de IVA da UE (VIES). name=null quando desconhecido.
export async function lookupSupplierName(nif: string): Promise<{ name: string | null; source: string | null }> {
  const response = await apiFetch(`/suppliers/lookup?nif=${encodeURIComponent(nif)}`);
  if (!response.ok) throw new Error('Falha ao procurar o NIF');
  return response.json();
}

export interface ExtractedDocument {
  parsedQr: ParsedInvoiceQr | null;
  qrRawPayload: string | null;
  ocrFields: Partial<Pick<ParsedInvoiceQr, 'issuerNif' | 'documentDate' | 'vatAmount' | 'totalAmount' | 'baseAmount'>> | null;
  originalFilePath: string;
  /** URL assinada de curta duração — usar para pré-visualização (resolveFileUrl), nunca originalFilePath diretamente. */
  fileUrl: string | null;
  fileMimeType: string;
}

export async function extractDocument(file: CapturedFile): Promise<ExtractedDocument> {
  const formData = new FormData();
  await appendFileToFormData(formData, file);

  const response = await apiFetch('/expenses/extract', { method: 'POST', body: formData });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? 'Falha ao processar o ficheiro');
  }
  return response.json();
}

export async function getExpense(id: string): Promise<Expense> {
  const response = await apiFetch(`/expenses/${id}`);
  if (!response.ok) throw new Error('Falha ao carregar a despesa');
  return response.json();
}

export async function updateExpense(
  id: string,
  input: Partial<ExpenseInput> & { status?: ExpenseStatus },
): Promise<Expense> {
  const response = await apiFetch(`/expenses/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? 'Falha ao guardar alterações');
  }
  return response.json();
}

export async function deleteExpense(id: string): Promise<void> {
  const response = await apiFetch(`/expenses/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? 'Falha ao eliminar despesa');
  }
}

export async function listAcquirerNifSummaries(): Promise<AcquirerNifSummary[]> {
  const response = await apiFetch('/expenses/summary/nifs');
  if (!response.ok) throw new Error('Falha ao carregar resumo por NIF');
  return response.json();
}

export async function listMonthlySummaries(acquirerNif: string): Promise<MonthlySummary[]> {
  const response = await apiFetch(`/expenses/summary/nifs/${encodeURIComponent(acquirerNif)}/months`);
  if (!response.ok) throw new Error('Falha ao carregar resumo mensal');
  return response.json();
}

// Recebe SEMPRE um fileUrl (já assinado pelo servidor), nunca originalFilePath
// diretamente — /uploads deixou de ser servido sem autenticação, ver
// apps/server/src/utils/uploads-path.ts.
export function resolveFileUrl(fileUrl: string): string {
  return `${API_BASE_URL}/${fileUrl}`;
}

export async function updateReportStatus(
  acquirerNif: string,
  period: string,
  status: ReportStatus,
): Promise<void> {
  const response = await apiFetch(
    `/expenses/summary/nifs/${encodeURIComponent(acquirerNif)}/months/${encodeURIComponent(period)}/status`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? 'Falha ao atualizar o estado do mês');
  }
}

export function getReportPdfUrl(acquirerNif: string, period: string, label?: string): string {
  const query = label ? `?label=${encodeURIComponent(label)}` : '';
  return `${API_BASE_URL}/reports/${encodeURIComponent(acquirerNif)}/${encodeURIComponent(period)}/pdf${query}`;
}

export function getReportExcelUrl(acquirerNif: string, period: string, label?: string): string {
  const query = label ? `?label=${encodeURIComponent(label)}` : '';
  return `${API_BASE_URL}/reports/${encodeURIComponent(acquirerNif)}/${encodeURIComponent(period)}/xlsx${query}`;
}

// Relatório personalizado: intervalo de meses (ex: "2026-06" a "2026-08").
export function getReportRangePdfUrl(acquirerNif: string, from: string, to: string, label?: string): string {
  const params = new URLSearchParams({ from, to });
  if (label) params.set('label', label);
  return `${API_BASE_URL}/reports/${encodeURIComponent(acquirerNif)}/pdf?${params.toString()}`;
}

export function getReportRangeExcelUrl(acquirerNif: string, from: string, to: string, label?: string): string {
  const params = new URLSearchParams({ from, to });
  if (label) params.set('label', label);
  return `${API_BASE_URL}/reports/${encodeURIComponent(acquirerNif)}/xlsx?${params.toString()}`;
}

// Termina a sessão no servidor (invalida o Session row) e limpa o token local
// — sem isto não havia forma de terminar sessão a partir da app (ver
// clearSessionToken em state/session.ts, que ficava por chamar).
export async function logout(): Promise<void> {
  await apiFetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
  await clearSessionToken();
  router.replace('/login');
}
