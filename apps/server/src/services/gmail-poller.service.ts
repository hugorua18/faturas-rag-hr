import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { google, type gmail_v1 } from 'googleapis';
import type { User } from '@prisma/client';
import { EMAIL_INGEST_ACCOUNT } from '@invoice-scanner/shared';
import { ingestDocument } from './document-ingest.service';
import { archiveInvoiceToDriveBestEffort } from './drive.service';
import { scheduleSheetsSyncSoon } from './sheets-export.service';
import { prisma } from '../db/prisma';

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const SEARCH_QUERY = 'has:attachment newer_than:30d';

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

// Tipos que o ingestDocument sabe processar. HEIC/HEIF (fotos de iPhone) são
// explicitamente excluídos: o @napi-rs/canvas não os descodifica e aceitá-los
// só criaria mensagens "envenenadas" a falhar em todos os polls.
const SUPPORTED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const EXTENSION_MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

// Muitos clientes de email enviam PDFs/imagens como "application/octet-stream"
// — decidir só pelo mimeType declarado deixava essas faturas invisíveis. A
// extensão do nome do ficheiro desempata; devolve null para anexos que não
// sabemos processar (esses são ignorados de propósito, não contam como falha).
function effectiveMimeType(filename: string, declaredMimeType: string): string | null {
  if (SUPPORTED_MIME_TYPES.has(declaredMimeType)) return declaredMimeType;
  const byExtension = EXTENSION_MIME_TYPES[path.extname(filename).toLowerCase()];
  if (byExtension && (declaredMimeType === 'application/octet-stream' || !declaredMimeType)) return byExtension;
  if (declaredMimeType.startsWith('image/') && !/heic|heif/i.test(declaredMimeType)) return declaredMimeType;
  return null;
}

interface AttachmentPart {
  filename: string;
  mimeType: string;
  attachmentId: string;
}

function collectAttachmentParts(part: gmail_v1.Schema$MessagePart | undefined, out: AttachmentPart[]): void {
  if (!part) return;
  const attachmentId = part.body?.attachmentId;
  if (attachmentId && part.filename) {
    const mimeType = effectiveMimeType(part.filename, part.mimeType ?? '');
    if (mimeType) out.push({ filename: part.filename, mimeType, attachmentId });
  }
  for (const child of part.parts ?? []) {
    collectAttachmentParts(child, out);
  }
}

function getGmailClient(): gmail_v1.Gmail | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth });
}

// A quem pertencem as despesas ingeridas por email? A funcionalidade é
// EXCLUSIVA da conta da própria caixa monitorizada (EMAIL_INGEST_ACCOUNT):
// todas as faturas recebidas lá aparecem na fila de tratamento manual dessa
// conta — os restantes utilizadores não têm ingestão por email (o UI
// esconde-lhes a opção, ver hooks/use-email-feature.ts). Consulta direta à
// base, sem depender de uma chamada de rede ao Gmail nem de contar
// utilizadores — a versão anterior fazia gmail.users.getProfile() e recuava
// para "só há um utilizador", heurística que partia assim que a app passou a
// ter mais do que uma conta: uma falha transitória da chamada ao Gmail (ex:
// arranque a frio do Render) deixava as faturas em espera até ao poll
// seguinte, sem necessidade nenhuma.
async function resolveIngestUser(): Promise<User | null> {
  return prisma.user.findUnique({ where: { email: EMAIL_INGEST_ACCOUNT } });
}

// Devolve true se a mensagem ficou completamente processada. Falhas num anexo
// deixam a mensagem POR marcar (retry no próximo poll) — antes, a mensagem era
// marcada como processada mesmo com anexos falhados, perdendo a fatura para
// sempre (ex: falha transitória de rede ou do processamento do PDF).
async function processMessage(gmail: gmail_v1.Gmail, messageId: string, user: User): Promise<boolean> {
  const { data: message } = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });

  const attachmentParts: AttachmentPart[] = [];
  collectAttachmentParts(message.payload, attachmentParts);

  let failures = 0;
  for (const part of attachmentParts) {
    try {
      const { data: attachment } = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: part.attachmentId,
      });
      if (!attachment.data) continue;

      const buffer = Buffer.from(attachment.data, 'base64url');
      const { parsedQr, qrText, ocrFields, imageBuffer, imageMimeType } = await ingestDocument(buffer, part.mimeType);

      const ext = imageMimeType === 'image/png' ? '.png' : '.jpg';
      const filename = `${crypto.randomUUID()}${ext}`;
      fs.writeFileSync(path.join(uploadsDir, filename), imageBuffer);

      const expense = await prisma.expense.create({
        data: {
          userId: user.id,
          status: 'TRATAMENTO_MANUAL',
          source: 'EMAIL',
          type: 'OUTROS',
          supplierName: ocrFields?.supplierName || undefined,
          supplierNif: parsedQr?.issuerNif || ocrFields?.issuerNif || undefined,
          acquirerNif: parsedQr?.acquirerNif || ocrFields?.acquirerNif || undefined,
          documentType: parsedQr?.documentType || undefined,
          documentId: parsedQr?.documentId || ocrFields?.documentId || undefined,
          documentDate: parsedQr?.documentDate || ocrFields?.documentDate || undefined,
          documentTime: ocrFields?.documentTime || undefined,
          amountBase: parsedQr?.baseAmount ?? ocrFields?.baseAmount ?? undefined,
          amountVat: parsedQr?.vatAmount ?? ocrFields?.vatAmount ?? undefined,
          amountTotal: parsedQr?.totalAmount ?? ocrFields?.totalAmount ?? undefined,
          originalFilePath: `uploads/${filename}`,
          qrRawPayload: qrText || undefined,
        },
      });
      // Arquiva já no Drive (não só na confirmação): o disco do Render é
      // efémero — sem isto, a imagem da fatura perdia-se no deploy seguinte
      // e a fila "Tratamento manual" mostrava despesas sem visualização.
      archiveInvoiceToDriveBestEffort(user, expense);
    } catch (err) {
      failures++;
      console.error(`[gmail-poller] falha a processar anexo "${part.filename}" da mensagem ${messageId}`, err);
    }
  }

  if (failures > 0) {
    console.warn(
      `[gmail-poller] mensagem ${messageId} fica por marcar (${failures} anexo(s) falhado(s)) — nova tentativa no próximo poll`,
    );
    return false;
  }

  await prisma.processedEmail.create({ data: { gmailMessageId: messageId } });
  return true;
}

export async function poll(): Promise<void> {
  const gmail = getGmailClient();
  if (!gmail) return;

  const user = await resolveIngestUser();
  if (!user) {
    console.warn(
      '[gmail-poller] nenhum utilizador da app corresponde à caixa monitorizada — faturas de email ficam em espera até haver login.',
    );
    return;
  }

  // Autocura: despesas de email criadas antes deste fix ficaram sem dono
  // (userId null) e por isso invisíveis em todas as listas da app — reclamá-las
  // aqui torna-as visíveis sem intervenção manual na base de dados.
  const claimed = await prisma.expense.updateMany({
    where: { userId: null, source: 'EMAIL' },
    data: { userId: user.id },
  });
  if (claimed.count > 0) {
    console.log(`[gmail-poller] ${claimed.count} despesa(s) de email órfã(s) atribuída(s) a ${user.email}`);
  }

  // A lista do Gmail é paginada (100 por página) — sem o ciclo de pageToken,
  // caixas com mais de 100 mensagens na janela de pesquisa perdiam as restantes.
  let pageToken: string | undefined;
  let processedAny = false;
  do {
    const { data } = await gmail.users.messages.list({ userId: 'me', q: SEARCH_QUERY, pageToken });
    for (const { id } of data.messages ?? []) {
      if (!id) continue;
      const alreadyProcessed = await prisma.processedEmail.findUnique({ where: { gmailMessageId: id } });
      if (alreadyProcessed) continue;
      await processMessage(gmail, id, user);
      processedAny = true;
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);

  // Novas despesas de email → refletir no registo Google Sheets do dono.
  if (processedAny) scheduleSheetsSyncSoon(user.id);
}

// Nunca deixar dois polls correr em simultâneo (o do intervalo + um pedido
// manual da app): a idempotência por ProcessedEmail é um check-then-create,
// e dois polls concorrentes podiam ambos processar a mesma mensagem antes de
// qualquer um gravar o registo — resultando numa despesa duplicada. Quem
// chegar durante um poll em curso simplesmente espera pelo resultado dele.
let pollInFlight: Promise<void> | null = null;

export function triggerPoll(): Promise<void> {
  if (!pollInFlight) {
    pollInFlight = poll().finally(() => {
      pollInFlight = null;
    });
  }
  return pollInFlight;
}

export function startGmailPolling(): void {
  if (!getGmailClient()) {
    console.warn(
      '[gmail-poller] GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN não definidos — ingestão automática por email desativada.',
    );
    return;
  }
  void triggerPoll().catch((err) => console.error('[gmail-poller] falha no polling inicial', err));
  setInterval(() => {
    void triggerPoll().catch((err) => console.error('[gmail-poller] falha no polling', err));
  }, POLL_INTERVAL_MS);
}
