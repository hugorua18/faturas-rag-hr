import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Token opaco de sessão (Google Sign-In) devolvido por POST /auth/google/callback.
// Guardado no SecureStore do dispositivo; cache em memória para não obrigar todos
// os consumidores (ex: apiFetch em cada pedido) a await SecureStore.getItemAsync.
//
// Na Web, o binding nativo do expo-secure-store (Keychain/Keystore) não existe —
// a implementação web desta versão do SDK rebenta ao ser chamada diretamente
// ("getValueWithKeyAsync is not a function"), por isso usamos localStorage como
// alternativa nesse caso. NOTA: a app web está publicada em produção
// (invoice-scanner.expo.app), não é só um preview de dev — localStorage é
// legível por qualquer script na mesma origem (XSS), o que é um risco real
// para este token de 30 dias. Se isto vier a importar mais (ex: mais tráfego
// web real), migrar para cookies httpOnly/Secure geridos pelo servidor.
const SESSION_TOKEN_KEY = 'session_token';

let cachedToken: string | null | undefined; // undefined = ainda não lido do storage

export async function getSessionToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  const stored =
    Platform.OS === 'web' ? window.localStorage.getItem(SESSION_TOKEN_KEY) : await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
  cachedToken = stored ?? null;
  return cachedToken;
}

export function getCachedSessionToken(): string | null | undefined {
  return cachedToken;
}

export async function setSessionToken(token: string): Promise<void> {
  cachedToken = token;
  if (Platform.OS === 'web') {
    window.localStorage.setItem(SESSION_TOKEN_KEY, token);
  } else {
    await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
  }
}

export async function clearSessionToken(): Promise<void> {
  cachedToken = null;
  cachedEmail = null;
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(SESSION_TOKEN_KEY);
    window.localStorage.removeItem(SESSION_EMAIL_KEY);
  } else {
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
    await SecureStore.deleteItemAsync(SESSION_EMAIL_KEY);
  }
}

// Email da conta com sessão iniciada — usado para mostrar/esconder
// funcionalidades por utilizador (ex.: a fila de email é exclusiva da conta
// da caixa de ingestão). Segue o mesmo esquema de storage do token.
const SESSION_EMAIL_KEY = 'session_email';

let cachedEmail: string | null | undefined;

export async function getSessionEmail(): Promise<string | null> {
  if (cachedEmail !== undefined) return cachedEmail;
  const stored =
    Platform.OS === 'web' ? window.localStorage.getItem(SESSION_EMAIL_KEY) : await SecureStore.getItemAsync(SESSION_EMAIL_KEY);
  cachedEmail = stored ?? null;
  return cachedEmail;
}

export async function setSessionEmail(email: string): Promise<void> {
  cachedEmail = email;
  if (Platform.OS === 'web') {
    window.localStorage.setItem(SESSION_EMAIL_KEY, email);
  } else {
    await SecureStore.setItemAsync(SESSION_EMAIL_KEY, email);
  }
}
