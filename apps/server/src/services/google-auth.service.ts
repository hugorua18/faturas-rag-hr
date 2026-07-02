import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

// Google Sign-In do utilizador final da app (sessão de app) — NÃO confundir com o
// fluxo OAuth do poller do Gmail (gmail-poller.service.ts / get-gmail-refresh-token.ts),
// que usa GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN para uma caixa de
// correio de ingestão dedicada. Este serviço usa variáveis de ambiente distintas.
// .trim(): valores colados no dashboard do Render podem trazer espaços/newlines
// invisíveis — para o client id iOS isso fazia a comparação exata em
// getOAuth2ClientForExchange falhar em silêncio e a troca do code cair no
// cliente Web errado (Google responde "unauthorized_client").
const GOOGLE_SIGNIN_CLIENT_ID = process.env.GOOGLE_SIGNIN_CLIENT_ID?.trim();
const GOOGLE_SIGNIN_CLIENT_SECRET = process.env.GOOGLE_SIGNIN_CLIENT_SECRET?.trim();
const GOOGLE_SIGNIN_IOS_CLIENT_ID = process.env.GOOGLE_SIGNIN_IOS_CLIENT_ID?.trim();

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
function getOAuth2ClientForExchange(
  redirectUri: string,
  clientId: string | undefined,
): { client: OAuth2Client; usedClientId: string } {
  if (clientId && GOOGLE_SIGNIN_IOS_CLIENT_ID && clientId === GOOGLE_SIGNIN_IOS_CLIENT_ID) {
    return {
      client: new OAuth2Client(GOOGLE_SIGNIN_IOS_CLIENT_ID, undefined, redirectUri),
      usedClientId: GOOGLE_SIGNIN_IOS_CLIENT_ID,
    };
  }
  // Trocar um code emitido para outro cliente falha no Google com um
  // "unauthorized_client" opaco — este aviso torna o desalinhamento entre o
  // clientId enviado pela app e os configurados no servidor imediatamente
  // visível nos logs (client ids são públicos, não são segredos).
  if (clientId && clientId !== GOOGLE_SIGNIN_CLIENT_ID) {
    console.warn(
      `[auth] clientId enviado pela app (${clientId}) não corresponde a nenhum configurado no servidor ` +
        `(web: ${GOOGLE_SIGNIN_CLIENT_ID ?? 'não definido'}, ios: ${GOOGLE_SIGNIN_IOS_CLIENT_ID ?? 'não definido'}) ` +
        '— a troca do code vai usar o cliente Web e deve falhar com unauthorized_client. ' +
        'Verifica a variável GOOGLE_SIGNIN_IOS_CLIENT_ID no Render.',
    );
  }
  return { client: getOAuth2Client(redirectUri), usedClientId: GOOGLE_SIGNIN_CLIENT_ID! };
}

export interface ExchangedTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string | null;
  // Client id que fez a troca — um refresh token só é utilizável pelo cliente
  // que o emitiu, por isso quem o guardar tem de guardar também este id
  // (User.googleAuthClientId) para o Drive usar o cliente certo no refresh.
  usedClientId: string;
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
  const { client, usedClientId } = getOAuth2ClientForExchange(redirectUri, clientId);
  const { tokens } = await client.getToken({ code, redirect_uri: redirectUri, codeVerifier });

  if (!tokens.id_token || !tokens.access_token) {
    throw new Error('Resposta do Google não incluiu id_token/access_token');
  }

  return {
    idToken: tokens.id_token,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    usedClientId,
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
