import crypto from 'node:crypto';
import path from 'node:path';

export const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

// originalFilePath só é seguro de usar em fs.rm/fs.readFileSync se corresponder
// exatamente ao formato gerado pelo próprio servidor ("uploads/<uuid>.<ext>") —
// sem isto, um valor como "uploads/../../../../.env" (client-supplied via
// existingFilePath em POST /expenses) permite ler/apagar ficheiros arbitrários.
const SAFE_UPLOAD_PATH = /^uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|pdf)$/i;

// Resolve originalFilePath para um caminho absoluto dentro de uploadsDir, ou
// devolve null se não corresponder ao formato esperado ou tentar escapar do
// diretório (dupla verificação: regex de formato + path.resolve/startsWith).
export function resolveSafeUploadPath(originalFilePath: string | null | undefined): string | null {
  if (!originalFilePath || !SAFE_UPLOAD_PATH.test(originalFilePath)) return null;
  const uploadsRoot = path.join(uploadsDir, '..');
  const resolved = path.resolve(uploadsRoot, originalFilePath);
  if (!resolved.startsWith(uploadsDir + path.sep)) return null;
  return resolved;
}

// URLs de imagens de fatura passam a exigir uma assinatura de curta duração em
// vez de serem servidas por express.static sem autenticação nenhuma — um link
// que vaze (histórico do browser, logs de proxy, um relatório partilhado) deixa
// de dar acesso permanente ao documento. Não se usa um header Authorization
// porque <Image>/<img> não o suporta de forma fiável em todas as plataformas
// (nomeadamente Web, onde <img> não permite headers customizados).
const FILE_ACCESS_TTL_MS = 15 * 60 * 1000;

function getFileAccessKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('TOKEN_ENCRYPTION_KEY não está configurada — necessária para assinar URLs de ficheiros');
  }
  // Deriva uma chave distinta da usada para cifrar refresh tokens (AES-256-GCM
  // em google-auth.service.ts) — mesma chave de origem, propósito HMAC diferente.
  return crypto.createHmac('sha256', Buffer.from(raw, 'base64')).update('uploads-file-access-v1').digest();
}

function sign(originalFilePath: string, expiresAt: number): string {
  return crypto.createHmac('sha256', getFileAccessKey()).update(`${originalFilePath}.${expiresAt}`).digest('base64url');
}

// Só deve ser chamado depois de o pedido original já ter passado por
// requireAuth + verificação de dono (ex: uma query Prisma filtrada por
// userId) — a assinatura em si não volta a verificar posse, só formato+prazo.
export function signUploadPath(originalFilePath: string | null | undefined): string | null {
  if (!originalFilePath || !SAFE_UPLOAD_PATH.test(originalFilePath)) return null;
  const expiresAt = Date.now() + FILE_ACCESS_TTL_MS;
  return `${originalFilePath}?exp=${expiresAt}&sig=${sign(originalFilePath, expiresAt)}`;
}

export function verifyUploadSignature(originalFilePath: string, expiresAtRaw: string, sig: string): boolean {
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;
  const expected = Buffer.from(sign(originalFilePath, expiresAt));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
