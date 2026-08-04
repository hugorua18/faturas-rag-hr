import { Modal, Pressable, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';

import type { useTheme } from '@/hooks/use-theme';
import { confirmDeleteAccount, confirmLogout } from '@/utils/account-actions';

type Theme = ReturnType<typeof useTheme>;

// Menu de conta partilhado pelos ecrãs com o ícone de sessão (câmara e lista
// de despesas): Categorias + Fornecedores + Terminar sessão + Eliminar conta.
// Um Modal próprio (não Alert.alert) para funcionar de forma idêntica em iOS
// e Web — o Alert multi-botão do React Native Web é um no-op.
export function AccountMenuModal({ visible, onClose, theme }: { visible: boolean; onClose: () => void; theme: Theme }) {
  function handleCategories() {
    onClose();
    router.push('/categories');
  }

  function handleSuppliers() {
    onClose();
    router.push('/suppliers');
  }

  function handleVatSettings() {
    onClose();
    router.push('/vat-settings');
  }

  function handleLogout() {
    onClose();
    confirmLogout();
  }

  function handleDelete() {
    onClose();
    confirmDeleteAccount();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.card, { backgroundColor: theme.card }]} onPress={(e) => e.stopPropagation()}>
          <Text style={[styles.title, { color: theme.textSecondary }]}>Conta</Text>
          <Pressable
            style={[styles.option, { borderBottomColor: theme.separator, borderBottomWidth: StyleSheet.hairlineWidth }]}
            onPress={handleCategories}
          >
            <Text style={[styles.optionText, { color: theme.text }]}>Categorias</Text>
          </Pressable>
          <Pressable
            style={[styles.option, { borderBottomColor: theme.separator, borderBottomWidth: StyleSheet.hairlineWidth }]}
            onPress={handleSuppliers}
          >
            <Text style={[styles.optionText, { color: theme.text }]}>Fornecedores</Text>
          </Pressable>
          <Pressable
            style={[styles.option, { borderBottomColor: theme.separator, borderBottomWidth: StyleSheet.hairlineWidth }]}
            onPress={handleVatSettings}
          >
            <Text style={[styles.optionText, { color: theme.text }]}>IVA dedutível</Text>
          </Pressable>
          <Pressable
            style={[styles.option, { borderBottomColor: theme.separator, borderBottomWidth: StyleSheet.hairlineWidth }]}
            onPress={handleLogout}
          >
            <Text style={[styles.optionText, { color: theme.text }]}>Terminar sessão</Text>
          </Pressable>
          <Pressable style={styles.option} onPress={handleDelete}>
            <Text style={[styles.optionText, { color: theme.destructive }]}>Eliminar conta</Text>
          </Pressable>
          <Pressable style={styles.cancel} onPress={onClose}>
            <Text style={[styles.cancelText, { color: theme.accent }]}>Cancelar</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: { width: '100%', maxWidth: 340, borderRadius: 16, paddingTop: 14, overflow: 'hidden' },
  title: { fontSize: 12, fontWeight: '600', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  option: { paddingVertical: 14, alignItems: 'center' },
  optionText: { fontSize: 16.5, fontWeight: '500' },
  cancel: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  cancelText: { fontSize: 16.5, fontWeight: '700' },
});
