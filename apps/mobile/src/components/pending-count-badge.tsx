import { StyleSheet, Text, View } from 'react-native';

// Bolinha vermelha estilo iOS com o nº de documentos na fila "Tratamento
// manual" — desenhada por cima do ícone do envelope (o Pressable pai serve de
// âncora do position: absolute). Não renderiza nada quando a fila está vazia.
export function PendingCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View style={styles.badge} pointerEvents="none">
      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
