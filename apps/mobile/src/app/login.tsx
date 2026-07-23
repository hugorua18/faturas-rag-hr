import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';
import { MaxContentWidth } from '@/constants/theme';
import { API_BASE_URL, GOOGLE_SIGNIN_CLIENT_ID_IOS, GOOGLE_SIGNIN_CLIENT_ID_WEB } from '@/api/config';
import { setSessionToken } from '@/state/session';
import {
  captureWebLoginReturn,
  WEB_LOGIN_ERROR_KEY,
  WEB_LOGIN_REQUEST_KEY,
  WEB_LOGIN_RETURN_KEY,
} from '@/utils/web-login-return';

// Necessário para fechar o popup/browser de autenticação corretamente
// (sobretudo na Web) quando o redirect volta para a app.
WebBrowser.maybeCompleteAuthSession();

const SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'];

// ---- Fluxo Web por redirect (sem popup) -----------------------------------
// O fluxo por popup (promptAsync) tornou-se pouco fiável na Web: consoante o
// browser/bloqueador de popups, a autenticação abre numa janela nova SEM
// window.opener e o resultado nunca chega à janela original — o utilizador
// escolhe a conta e "volta ao ecrã de login" sem erro visível. Em vez disso,
// a Web navega para o Google NA PRÓPRIA janela: o par PKCE fica em
// localStorage e, no regresso com ?code=..., a troca completa-se aqui. A
// captura do ?code vive em web-login-return.ts, importado (com efeito) pelo
// _layout — este módulo de rota só executa quando /login monta, tarde demais.

function resolveClientId(): string {
  // Client id iOS (sem secret) para builds nativas; web/dev client como
  // fallback para Expo Go / dev client / Web, onde o fluxo passa por browser.
  return Platform.OS === 'ios' && GOOGLE_SIGNIN_CLIENT_ID_IOS
    ? GOOGLE_SIGNIN_CLIENT_ID_IOS
    : GOOGLE_SIGNIN_CLIENT_ID_WEB;
}

// Os clientes OAuth iOS do Google só aceitam como redirect o esquema
// "reverse client ID" (com.googleusercontent.apps.<id>:/oauth2redirect) —
// qualquer outro esquema (ex: invoicescanner://) é rejeitado pelo Google com
// "Acesso bloqueado / Erro 400: invalid_request" antes sequer de mostrar o
// seletor de contas. Este esquema também tem de estar registado no app.json
// ("scheme") para o redirect voltar a abrir a app.
function resolveRedirectUri(): string {
  if (Platform.OS === 'ios' && GOOGLE_SIGNIN_CLIENT_ID_IOS.endsWith('.apps.googleusercontent.com')) {
    const id = GOOGLE_SIGNIN_CLIENT_ID_IOS.replace('.apps.googleusercontent.com', '');
    return `com.googleusercontent.apps.${id}:/oauth2redirect`;
  }
  return AuthSession.makeRedirectUri({ scheme: 'invoicescanner' });
}

export default function LoginScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const discovery = AuthSession.useAutoDiscovery('https://accounts.google.com');
  const redirectUri = resolveRedirectUri();

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: resolveClientId(),
      scopes: SCOPES,
      redirectUri,
      // expo-auth-session usa PKCE por omissão para o response type 'code'.
      responseType: 'code',
      // access_type=offline é obrigatório para o Google alguma vez devolver um
      // refresh_token — sem isto NENHUM login (nem o primeiro) recebe um, e o
      // arquivo no Drive (Fase 8) falha sempre em silêncio ("Utilizador sem
      // refresh token do Google Sign-In"). O refresh_token só vem no ecrã de
      // consentimento, que o Google mostra automaticamente na primeira
      // autorização de cada conta — não forçamos prompt=consent em todos os
      // logins porque isso acrescentava dois ecrãs ("signing back in" +
      // "already has some access") a cada sessão. Se o token guardado se
      // perder, remover o acesso da app em myaccount.google.com/connections
      // força novo consentimento (e novo token) no login seguinte.
      // select_account força o seletor de contas: sem ele, no iOS (onde o
      // browser de autenticação partilha a sessão Google do Safari) o Google
      // escolhe silenciosamente a conta já autenticada, sem dar hipótese de
      // usar outra conta (ex: faturas.rag.hr em vez da conta pessoal).
      extraParams: { access_type: 'offline', prompt: 'select_account' },
    },
    discovery,
  );

  // Regresso do redirect Web: o module scope acima guardou a query string em
  // localStorage antes de os redirects do router a apagarem — retoma daqui.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    // Rede de segurança: se por alguma razão a captura do arranque não correu
    // e o ?code ainda está no URL, captura-o agora (é idempotente).
    captureWebLoginReturn();
    const returnSearch = window.localStorage.getItem(WEB_LOGIN_RETURN_KEY);
    if (!returnSearch) {
      // Sem regresso OAuth pendente: repõe um erro de uma tentativa anterior
      // que uma remontagem do ecrã possa ter apagado.
      const storedError = window.localStorage.getItem(WEB_LOGIN_ERROR_KEY);
      if (storedError) {
        window.localStorage.removeItem(WEB_LOGIN_ERROR_KEY);
        setError(storedError);
      }
      return;
    }
    window.localStorage.removeItem(WEB_LOGIN_RETURN_KEY);

    const params = new URLSearchParams(returnSearch);
    const code = params.get('code');
    const state = params.get('state');
    const storedRaw = window.localStorage.getItem(WEB_LOGIN_REQUEST_KEY);
    window.localStorage.removeItem(WEB_LOGIN_REQUEST_KEY);

    if (params.get('error') || !code) {
      setError('Falha na autenticação com o Google. Tenta novamente.');
      return;
    }
    if (!storedRaw) {
      setError('O pedido de autenticação expirou. Tenta novamente.');
      return;
    }
    try {
      const stored = JSON.parse(storedRaw) as { codeVerifier?: string; state?: string; redirectUri?: string };
      if (!stored.state || stored.state !== state) {
        setError('O pedido de autenticação não corresponde (state inválido). Tenta novamente.');
        return;
      }
      void completeLogin(code, stored.codeVerifier, stored.redirectUri);
    } catch {
      setError('Falha ao retomar o início de sessão. Tenta novamente.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!response) return;

    if (response.type === 'success' && response.params.code) {
      // request.codeVerifier é gerado pelo useAuthRequest (PKCE) e tem de ser
      // reenviado ao servidor para a troca do code por tokens junto do Google —
      // sem ele, o code_challenge enviado no /authorize fica sem par no /token.
      completeLogin(response.params.code, request?.codeVerifier);
    } else if (response.type === 'error') {
      setError('Falha na autenticação com o Google');
    } else if (response.type === 'dismiss' || response.type === 'cancel') {
      // Na Web, o Chrome pode bloquear silenciosamente o popup do Google (sem
      // lançar erro) quando o clique não é reconhecido como gesto genuíno do
      // utilizador — o expo-auth-session interpreta isso como "dismiss" sem
      // qualquer feedback visual por omissão. Mostrar sempre uma mensagem aqui
      // evita que o botão pareça simplesmente não fazer nada.
      setError('Sessão de autenticação fechada antes de terminar. Verifica se o browser bloqueou o popup e tenta novamente.');
    } else if (response.type === 'locked') {
      setError('Já existe um pedido de autenticação em curso. Aguarda uns segundos e tenta novamente.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  // Inicia o fluxo adequado à plataforma: Web navega para o Google na própria
  // janela (ver comentário do WEB_LOGIN_REQUEST_KEY); nativo usa promptAsync.
  async function startLogin(): Promise<void> {
    if (Platform.OS !== 'web') {
      void promptAsync();
      return;
    }
    if (!discovery) return;
    const webRequest = new AuthSession.AuthRequest({
      clientId: resolveClientId(),
      scopes: SCOPES,
      redirectUri,
      responseType: 'code',
      extraParams: { access_type: 'offline', prompt: 'select_account' },
    });
    const authUrl = await webRequest.makeAuthUrlAsync(discovery);
    window.localStorage.setItem(
      WEB_LOGIN_REQUEST_KEY,
      JSON.stringify({ codeVerifier: webRequest.codeVerifier, state: webRequest.state, redirectUri }),
    );
    window.location.assign(authUrl);
  }

  async function completeLogin(
    code: string,
    codeVerifier: string | undefined,
    redirectUriUsed?: string,
  ): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/google/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          redirectUri: redirectUriUsed ?? redirectUri,
          codeVerifier,
          clientId: resolveClientId(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Falha ao iniciar sessão');
      }
      const body: { sessionToken: string; user: { id: string; email: string } } = await res.json();
      await setSessionToken(body.sessionToken);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao iniciar sessão';
      if (Platform.OS === 'web') {
        window.localStorage.setItem(WEB_LOGIN_ERROR_KEY, message);
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.groupedBackground, paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>Digitalizador de Faturas</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          Inicia sessão com a tua conta Google para continuar.
        </Text>

        <Pressable
          style={[styles.button, { backgroundColor: theme.accent, opacity: !request || submitting ? 0.6 : 1 }]}
          disabled={!request || submitting}
          onPress={() => {
            if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            void startLogin();
          }}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Iniciar sessão com o Google</Text>
          )}
        </Pressable>

        {error ? <Text style={[styles.error, { color: theme.destructive }]}>{error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    minWidth: 240,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    marginTop: 16,
    fontSize: 14,
    textAlign: 'center',
  },
});
