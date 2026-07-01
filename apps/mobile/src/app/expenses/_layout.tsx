import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';

export default function ExpensesLayout() {
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTintColor: theme.accent,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.background },
        headerTitleStyle: { color: theme.text },
        headerBackTitle: 'Voltar',
        contentStyle: { backgroundColor: theme.groupedBackground },
      }}
    >
      {/* headerLargeTitle desativado: o título grande sobrepunha-se à lista,
          porque o sistema nativo só ajusta automaticamente o espaço do
          conteúdo quando a lista é o filho direto do ecrã — aqui há outros
          elementos (spinner, erro) antes dela. Título normal é fiável. */}
      <Stack.Screen name="index" options={{ title: 'Escolha o NIF' }} />
      <Stack.Screen name="[nif]/index" options={{ title: 'Meses' }} />
      <Stack.Screen name="[nif]/[period]" options={{ title: 'Despesas' }} />
    </Stack>
  );
}
