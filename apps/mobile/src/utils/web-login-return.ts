import { Platform } from 'react-native';

// Chaves do fluxo de login Web por redirect (ver login.tsx): o par PKCE fica
// guardado antes de navegar para o Google, e o ?code=... do regresso é
// capturado para localStorage antes de os redirects do router o apagarem.
export const WEB_LOGIN_REQUEST_KEY = 'invoice-scanner.web-login-request';
export const WEB_LOGIN_RETURN_KEY = 'invoice-scanner.web-login-return';
export const WEB_LOGIN_ERROR_KEY = 'invoice-scanner.web-login-error';

// Captura o retorno OAuth. Tem de correr no arranque da app (import com efeito
// em _layout.tsx) e NÃO no módulo do ecrã de login: o expo-router só executa o
// módulo de uma rota quando ela monta, e o /login só monta DEPOIS de os
// redirects (raiz → /expenses → guard → /login) já terem destruído a query
// string onde o Google pôs o code. Idempotente — depois de capturar, limpa o
// URL, portanto uma segunda chamada não faz nada.
export function captureWebLoginReturn(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  if (!window.location.search.includes('code=')) return;
  if (!window.localStorage.getItem(WEB_LOGIN_REQUEST_KEY)) return;
  window.localStorage.setItem(WEB_LOGIN_RETURN_KEY, window.location.search);
  window.history.replaceState(null, '', window.location.pathname);
}

captureWebLoginReturn();
