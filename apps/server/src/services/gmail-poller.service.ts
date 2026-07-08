import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { google, type gmail_v1 } from 'googleapis';
import type { User } from '@prisma/client';
import { ingestDocument } from './document-ingest.service';
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

// A quem pertencem as despesas ingeridas por email? Desde a Fase 7 (sessões),
// TODAS as rotas filtram por userId — uma despesa sem dono é invisível na app
// (foi exatamente esse o bug: o poller criava despesas sem userId e elas nunca
// apareciam na fila "Tratamento manual"). Preferência: o utilizador cujo email
// é o da própria caixa monitorizada; senão, se a app só tem um utilizador
// (é single-user por desenho), é ele.
async function resolveIngestUser(gmail: gmail_v1.Gmail): Promise<User | null> {
  try {
    const { data } = await gmail.users.getProfile({ userId: 'me' });
    if (data.emailAddress) {
      const byEmail = await prisma.user.findUnique({ where: { email: data.emailAddress } });
      if (byEmail) return byEmail;
    }
  } catch {
    // getProfile é só uma preferência — o fallback abaixo cobre.
  }
  const users = await prisma.user.findMany({ take: 2 });
  return users.length === 1 ? users[0] : null;
}

// Devolve true se a mensagem ficou completamente processada. Falhas num anexo
// deixam a mensagem POR marcar (retry no próximo poll) — antes, a mensagem era
// marcada como processada mesmo com anexos falhados, perdendo a fatura para
// sempre (ex: falha transitória de rede ou do processamento do PDF).
async function processMessage(gmail: gmail_v1.Gmail, messageId: string, userId: string): Promise<boolean> {
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

      await prisma.expense.create({
        data: {
          userId,
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

  const user = await resolveIngestUser(gmail);
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
  do {
    const { data } = await gmail.users.messages.list({ userId: 'me', q: SEARCH_QUERY, pageToken });
    for (const { id } of data.messages ?? []) {
      if (!id) continue;
      const alreadyProcessed = await prisma.processedEmail.findUnique({ where: { gmailMessageId: id } });
      if (alreadyProcessed) continue;
      await processMessage(gmail, id, user.id);
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
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
