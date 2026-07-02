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

// Necessário para fechar o popup/browser de autenticação corretamente
// (sobretudo na Web) quando o redirect volta para a app.
WebBrowser.maybeCompleteAuthSession();

const SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'];

function resolveClientId(): string {
  // Client id iOS (sem secret) para builds nativas; web/dev client como
  // fallback para Expo Go / dev client / Web, onde o fluxo passa por browser.
  return Platform.OS === 'ios' && GOOGLE_SIGNIN_CLIENT_ID_IOS
    ? GOOGLE_SIGNIN_CLIENT_ID_IOS
    : GOOGLE_SIGNIN_CLIENT_ID_WEB;
}

export default function LoginScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const discovery = AuthSession.useAutoDiscovery('https://accounts.google.com');
  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'invoicescanner' });

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
      // refresh token do Google Sign-In"). prompt=consent força sempre o ecrã
      // de consentimento, para contas que já autorizaram a app antes deste fix
      // (sem refresh_token guardado) também conseguirem obter um novo.
      // select_account força o seletor de contas: sem ele, no iOS (onde o
      // browser de autenticação partilha a sessão Google do Safari) o Google
      // escolhe silenciosamente a conta já autenticada, sem dar hipótese de
      // usar outra conta (ex: faturas.rag.hr em vez da conta pessoal).
      extraParams: { access_type: 'offline', prompt: 'select_account consent' },
    },
    discovery,
  );

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

  async function completeLogin(code: string, codeVerifier: string | undefined): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/google/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, redirectUri, codeVerifier, clientId: resolveClientId() }),
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
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(err instanceof Error ? err.message : 'Falha ao iniciar sessão');
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
            promptAsync();
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
