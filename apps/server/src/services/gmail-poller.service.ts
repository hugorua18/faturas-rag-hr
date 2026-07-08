import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { google, type gmail_v1 } from 'googleapis';
import { ingestDocument } from './document-ingest.service';
import { prisma } from '../db/prisma';

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const SEARCH_QUERY = 'has:attachment newer_than:30d';
const ATTACHMENT_MIME_TYPES = ['application/pdf'];

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

function isSupportedAttachmentMimeType(mimeType: string): boolean {
  return ATTACHMENT_MIME_TYPES.includes(mimeType) || mimeType.startsWith('image/');
}

interface AttachmentPart {
  filename: string;
  mimeType: string;
  attachmentId: string;
}

function collectAttachmentParts(part: gmail_v1.Schema$MessagePart | undefined, out: AttachmentPart[]): void {
  if (!part) return;
  const attachmentId = part.body?.attachmentId;
  if (attachmentId && part.filename && part.mimeType && isSupportedAttachmentMimeType(part.mimeType)) {
    out.push({ filename: part.filename, mimeType: part.mimeType, attachmentId });
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

async function processMessage(gmail: gmail_v1.Gmail, messageId: string): Promise<void> {
  const { data: message } = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });

  const attachmentParts: AttachmentPart[] = [];
  collectAttachmentParts(message.payload, attachmentParts);

  for (const part of attachmentParts) {
    try {
      const { data: attachment } = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: part.attachmentId,
      });
      if (!attachment.data) continue;

      const buffer = Buffer.from(attachment.data, 'base64url');
      const { parsedQr, qrText, imageBuffer, imageMimeType } = await ingestDocument(buffer, part.mimeType);

      const ext = imageMimeType === 'image/png' ? '.png' : '.jpg';
      const filename = `${crypto.randomUUID()}${ext}`;
      fs.writeFileSync(path.join(uploadsDir, filename), imageBuffer);

      await prisma.expense.create({
        data: {
          status: 'TRATAMENTO_MANUAL',
          source: 'EMAIL',
          type: 'OUTROS',
          supplierNif: parsedQr?.issuerNif || undefined,
          acquirerNif: parsedQr?.acquirerNif || undefined,
          documentType: parsedQr?.documentType || undefined,
          documentId: parsedQr?.documentId || undefined,
          documentDate: parsedQr?.documentDate || undefined,
          amountBase: parsedQr?.baseAmount ?? undefined,
          amountVat: parsedQr?.vatAmount ?? undefined,
          amountTotal: parsedQr?.totalAmount ?? undefined,
          originalFilePath: `uploads/${filename}`,
          qrRawPayload: qrText || undefined,
        },
      });
    } catch (err) {
      console.error(`[gmail-poller] falha a processar anexo "${part.filename}" da mensagem ${messageId}`, err);
    }
  }

  await prisma.processedEmail.create({ data: { gmailMessageId: messageId } });
}

export async function poll(): Promise<void> {
  const gmail = getGmailClient();
  if (!gmail) return;

  const { data } = await gmail.users.messages.list({ userId: 'me', q: SEARCH_QUERY });
  const messages = data.messages ?? [];

  for (const { id } of messages) {
    if (!id) continue;
    const alreadyProcessed = await prisma.processedEmail.findUnique({ where: { gmailMessageId: id } });
    if (alreadyProcessed) continue;
    await processMessage(gmail, id);
  }
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
