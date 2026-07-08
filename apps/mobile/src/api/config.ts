import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * No telemóvel (Expo Go, LAN ou túnel), "localhost" resolve para o próprio
 * telemóvel — não para o Mac onde o backend corre. `hostUri` é o endereço a
 * partir do qual o bundle JS foi mesmo carregado (o mesmo Mac), por isso
 * apontamos para lá + "/api", que o metro.config.js reencaminha para o
 * backend real em localhost:4001.
 */
function resolveDevServerApiBaseUrl(): string | null {
  const hostUri = Constants.expoConfig?.hostUri;
  if (!hostUri) return null;
  const isTunnel = hostUri.includes('.exp.direct') || hostUri.includes('.ngrok');
  return `${isTunnel ? 'https' : 'http'}://${hostUri}/api`;
}

const PRODUCTION_API_URL = 'https://invoice-scanner-server.onrender.com';

function resolveDefaultApiBaseUrl(): string {
  if (Platform.OS === 'web') {
    // Na Web o default depende de onde a página está a correr: em produção
    // (invoice-scanner.expo.app) aponta para o servidor real. Antes, o default
    // era sempre localhost e um `expo export` sem EXPO_PUBLIC_API_URL no
    // ambiente cozia "localhost:4001" no bundle publicado — a webapp inteira
    // ficava em "Failed to fetch". O hostname em runtime é à prova disso.
    if (typeof window !== 'undefined' && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      return PRODUCTION_API_URL;
    }
    return 'http://localhost:4001';
  }
  return resolveDevServerApiBaseUrl() ?? 'http://localhost:4001';
}

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? resolveDefaultApiBaseUrl();

/**
 * Client IDs do Google Sign-In (Fase 7) — distintos do fluxo OAuth do Gmail no
 * servidor (esse é só para a caixa de ingestão, nunca corre no telemóvel). O
 * client id "iOS" não tem secret e é o usado em builds nativas iOS; o "web" é o
 * fallback usado no Expo Go / dev client (fluxo baseado em browser).
 * Preencher via variáveis de ambiente EXPO_PUBLIC_* (apps/mobile/.env, não commitado).
 */
export const GOOGLE_SIGNIN_CLIENT_ID_WEB = process.env.EXPO_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID_WEB ?? '';
export const GOOGLE_SIGNIN_CLIENT_ID_IOS = process.env.EXPO_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID_IOS ?? '';
