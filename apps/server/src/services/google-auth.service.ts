import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

// Google Sign-In do utilizador final da app (sessão de app) — NÃO confundir com o
// fluxo OAuth do poller do Gmail (gmail-poller.service.ts / get-gmail-refresh-token.ts),
// que usa GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN para uma caixa de
// correio de ingestão dedicada. Este serviço usa variáveis de ambiente distintas.
const GOOGLE_SIGNIN_CLIENT_ID = process.env.GOOGLE_SIGNIN_CLIENT_ID;
const GOOGLE_SIGNIN_CLIENT_SECRET = process.env.GOOGLE_SIGNIN_CLIENT_SECRET;
const GOOGLE_SIGNIN_IOS_CLIENT_ID = process.env.GOOGLE_SIGNIN_IOS_CLIENT_ID;

function getOAuth2Client(redirectUri?: string): OAuth2Client {
  if (!GOOGLE_SIGNIN_CLIENT_ID || !GOOGLE_SIGNIN_CLIENT_SECRET) {
    throw new Error(
      'GOOGLE_SIGNIN_CLIENT_ID / GOOGLE_SIGNIN_CLIENT_SECRET não estão configurados (apps/server/.env)',
    );
  }
  return new OAuth2Client(GOOGLE_SIGNIN_CLIENT_ID, GOOGLE_SIGNIN_CLIENT_SECRET, redirectUri);
}

// A troca do code por tokens tem de usar o mesmo client id que o cliente móvel
// usou para pedir a autorização (senão o Google rejeita o /token com
// "client_id mismatch"). O client id iOS não tem secret (fluxo público, PKCE);
// os restantes (web/dev) usam o client secret do servidor.
function getOAuth2ClientForExchange(redirectUri: string, clientId: string | undefined): OAuth2Client {
  if (clientId && clientId === GOOGLE_SIGNIN_IOS_CLIENT_ID) {
    return new OAuth2Client(GOOGLE_SIGNIN_IOS_CLIENT_ID, undefined, redirectUri);
  }
  return getOAuth2Client(redirectUri);
}

export interface ExchangedTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string | null;
}

// Troca o "authorization code" (PKCE) recebido do cliente móvel pelos tokens do
// Google. O cliente móvel gera o code_verifier/code_challenge (expo-auth-session)
// e reenvia o code_verifier aqui, que o passamos ao Google para completar a
// prova de posse PKCE — sem isto o code_challenge enviado no /authorize fica
// sem par no /token (Google rejeita, ou a proteção PKCE fica incompleta).
export async function exchangeAuthCodeForTokens(
  code: string,
  redirectUri: string,
  codeVerifier?: string,
  clientId?: string,
): Promise<ExchangedTokens> {
  const client = getOAuth2ClientForExchange(redirectUri, clientId);
  const { tokens } = await client.getToken({ code, redirect_uri: redirectUri, codeVerifier });

  if (!tokens.id_token || !tokens.access_token) {
    throw new Error('Resposta do Google não incluiu id_token/access_token');
  }

  return {
    idToken: tokens.id_token,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
  };
}

export interface VerifiedGoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
}

// Verifica o id_token contra o(s) client id(s) válidos — o pedido pode ter sido
// feito a partir do client id iOS ou do client id web/dev (Expo Go/dev client),
// por isso aceitamos qualquer uma das audiências configuradas.
export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
  const audiences = [GOOGLE_SIGNIN_CLIENT_ID, GOOGLE_SIGNIN_IOS_CLIENT_ID].filter(
    (value): value is string => Boolean(value),
  );
  if (audiences.length === 0) {
    throw new Error('Nenhum client id do Google Sign-In configurado para verificar o id_token');
  }

  const client = getOAuth2Client();
  const ticket = await client.verifyIdToken({ idToken, audience: audiences });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Error('id_token do Google inválido: payload sem sub/email');
  }

  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified ?? false,
  };
}

// TOKEN_ENCRYPTION_KEY: chave de 32 bytes (256 bits) codificada em base64 (ex:
// gerada com `openssl rand -base64 32`). AES-256-GCM: IV aleatório de 12 bytes
// por cifragem, guardado junto com a tag de autenticação e o texto cifrado,
// tudo concatenado e codificado em base64: base64(iv (12) | authTag (16) | ciphertext).
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

function getEncryptionKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY não está configurada (apps/server/.env) — necessária para cifrar refresh tokens',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY deve descodificar (base64) para exatamente 32 bytes');
  }
  return key;
}

export function encryptRefreshToken(raw: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptRefreshToken(enc: string): string {
  const key = getEncryptionKey();
  const buffer = Buffer.from(enc, 'base64');
  const iv = buffer.subarray(0, IV_LENGTH_BYTES);
  const authTag = buffer.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const ciphertext = buffer.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
