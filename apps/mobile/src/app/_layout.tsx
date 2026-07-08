import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, router } from 'expo-router';
import * as Linking from 'expo-linking';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useTheme } from '@/hooks/use-theme';
import { API_BASE_URL } from '@/api/config';
import { getSessionToken } from '@/state/session';
import { importSharedFile } from '@/utils/import-document';

SplashScreen.preventAutoHideAsync();
SplashScreen.hideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const theme = useTheme();

  // Guarda pragmática de presença de sessão — antes do ecrã de câmara
  // renderizar, confirma que há um token guardado; caso contrário manda para
  // o login. Não é uma reestruturação em grupos de rotas (auth)/(app), só um
  // efeito de nível de topo, suficiente para esta fase.
  useEffect(() => {
    getSessionToken().then((token) => {
      if (!token) router.replace('/login');
    });
  }, []);

  // O plano free do Render adormece o servidor ao fim de ~15 min de
  // inatividade — este ping fire-and-forget acorda-o logo ao abrir a app,
  // para o primeiro pedido real (lista, submissão) já apanhar o servidor
  // quente em vez de esperar ~50s por um arranque a frio (que ao utilizador
  // parecia a app congelada).
  useEffect(() => {
    fetch(`${API_BASE_URL}/health`).catch(() => {});
  }, []);

  // Ficheiros partilhados de outras apps (share sheet / "Abrir em…"): o iOS
  // copia o ficheiro para a Inbox da app e abre-a com um URL file:// — que o
  // expo-router não reconhece como rota, por isso é tratado aqui e segue o
  // mesmo fluxo do upload manual (extração → validação).
  useEffect(() => {
    const handleUrl = (url: string | null) => {
      // Pela extensão e não pelo scheme: o iOS/expo-router pode entregar o
      // caminho como file://... OU embrulhado no scheme da app
      // (invoicescanner://private/...). URLs de OAuth/rotas nunca terminam
      // numa extensão de documento, por isso não há colisão.
      if (!url || !/\.(pdf|png|jpe?g|webp|gif)(\?|#|$)/i.test(url)) return;
      importSharedFile(url);
    };
    Linking.getInitialURL().then(handleUrl).catch(() => {});
    const subscription = Linking.addEventListener('url', (event) => handleUrl(event.url));
    return () => subscription.remove();
  }, []);

  return (
    // O ecrã de recorte usa GestureDetector (react-native-gesture-handler),
    // que exige um GestureHandlerRootView algures acima na árvore — o
    // expo-router não o adiciona automaticamente.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack
          screenOptions={{
            headerShown: true,
            headerTintColor: theme.accent,
            headerShadowVisible: false,
            headerStyle: { backgroundColor: theme.background },
            headerTitleStyle: { color: theme.text },
            contentStyle: { backgroundColor: theme.groupedBackground },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen
            name="crop"
            options={{
              title: 'Ajustar margens',
              presentation: 'modal',
              // O gesto nativo de "arrastar para fechar" do modal compete com
              // o Pan gesture das bolas de recorte, sobretudo perto do fundo
              // do ecrã — o iOS reconhece o gesto de dispensar o modal antes
              // do nosso, e as bolas de baixo ficam impossíveis de arrastar.
              // Desligar aqui; o botão "Cancelar" continua a fechar o ecrã.
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="validation"
            options={{ title: 'Validar despesa', presentation: 'modal' }}
          />
          <Stack.Screen
            name="report-generate"
            options={{ title: 'Gerar relatório', presentation: 'modal' }}
          />
          <Stack.Screen name="expenses" options={{ headerShown: false }} />
          <Stack.Screen name="expense/[id]" options={{ title: 'Despesa', headerBackTitle: 'Voltar' }} />
          <Stack.Screen name="pending/index" options={{ title: 'Tratamento manual', headerBackTitle: 'Voltar' }} />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
