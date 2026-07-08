import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';

// Substitui o "Unmatched Route" assustador do expo-router. Caso especial: um
// ficheiro partilhado de outra app chega como URL que o router não reconhece
// (ex: invoicescanner://private/var/.../fatura.pdf) — o _layout já o está a
// importar nesse momento, por isso aqui só se mostra um estado de progresso
// até o replace para /validation acontecer.
export default function NotFoundScreen() {
  const theme = useTheme();
  const pathname = usePathname();
  const isSharedFile = /\.(pdf|png|jpe?g|webp|gif)$/i.test(pathname);

  return (
    <View style={[styles.container, { backgroundColor: theme.groupedBackground }]}>
      {isSharedFile ? (
        <>
          <ActivityIndicator color={theme.textSecondary} />
          <Text style={[styles.text, { color: theme.textSecondary }]}>A importar o documento…</Text>
        </>
      ) : (
        <>
          <Text style={[styles.title, { color: theme.text }]}>Página não encontrada</Text>
          <Pressable
            style={[styles.button, { backgroundColor: theme.accent }]}
            onPress={() => router.replace('/')}
          >
            <Text style={styles.buttonText}>Ir para o início</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 },
  title: { fontSize: 18, fontWeight: '700' },
  text: { fontSize: 14 },
  button: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
