import { Alert, Platform } from 'react-native';

import { deleteAccount, logout } from '@/api/client';
import { confirmAction, notify } from '@/utils/alert';

// Menu de conta partilhado pelos ecrãs com o ícone de sair (câmara e lista de
// despesas): Terminar sessão + Eliminar conta. A eliminação de conta dentro
// da app é uma exigência da App Store (guideline 5.1.1(v)) — tem confirmação
// dupla para evitar eliminações acidentais, o que a Apple permite.
export function showAccountMenu(): void {
  if (Platform.OS === 'web') {
    // Na Web o Alert multi-botão do RN é no-op; mantém-se o confirm simples
    // para terminar sessão e a eliminação faz-se no iOS (ou por contacto).
    confirmAction('Terminar sessão', 'Tens a certeza que queres sair da tua conta?', 'Terminar sessão', () => {
      void logout();
    });
    return;
  }
  Alert.alert('Conta', undefined, [
    { text: 'Terminar sessão', onPress: () => void logout() },
    { text: 'Eliminar conta', style: 'destructive', onPress: confirmDeleteAccount },
    { text: 'Cancelar', style: 'cancel' },
  ]);
}

function confirmDeleteAccount(): void {
  Alert.alert(
    'Eliminar conta',
    'Isto elimina permanentemente a tua conta e todas as despesas registadas na app. ' +
      'Os ficheiros já arquivados no teu Google Drive não são afetados. Esta ação não pode ser anulada.',
    [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar definitivamente',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteAccount();
            } catch (err) {
              notify('Erro', err instanceof Error ? err.message : 'Falha ao eliminar a conta');
            }
          })();
        },
      },
    ],
  );
}
