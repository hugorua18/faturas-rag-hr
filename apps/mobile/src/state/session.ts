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
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(SESSION_TOKEN_KEY);
  } else {
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
  }
}
