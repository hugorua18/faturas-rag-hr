import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';
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
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao iniciar sessão');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.groupedBackground }]}>
      <Text style={[styles.title, { color: theme.text }]}>Digitalizador de Faturas</Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
        Inicia sessão com a tua conta Google para continuar.
      </Text>

      <Pressable
        style={[styles.button, { backgroundColor: theme.accent, opacity: !request || submitting ? 0.6 : 1 }]}
        disabled={!request || submitting}
        onPress={() => promptAsync()}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Iniciar sessão com o Google</Text>
        )}
      </Pressable>

      {error ? <Text style={[styles.error, { color: theme.destructive }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
