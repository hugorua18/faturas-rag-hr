import { deleteAccount, logout } from '@/api/client';
import { confirmAction, notify } from '@/utils/alert';

// Ações de conta partilhadas pelo AccountMenuModal (câmara e lista de
// despesas). A eliminação de conta dentro da app é uma exigência da App
// Store (guideline 5.1.1(v)) — tem confirmação dupla para evitar eliminações
// acidentais. Usa confirmAction/notify (web-safe: window.confirm/alert na
// Web, Alert.alert nativo no iOS) em vez de Alert.alert diretamente — o
// Alert.alert multi-botão do React Native Web é um no-op, o que tornava esta
// ação inacessível na app Web.
export { logout };

export function confirmDeleteAccount(): void {
  confirmAction(
    'Eliminar conta',
    'Isto elimina permanentemente a tua conta e todas as despesas registadas na app. ' +
      'Os ficheiros já arquivados no teu Google Drive não são afetados. Esta ação não pode ser anulada.',
    'Eliminar definitivamente',
    () => {
      void (async () => {
        try {
          await deleteAccount();
        } catch (err) {
          notify('Erro', err instanceof Error ? err.message : 'Falha ao eliminar a conta');
        }
      })();
    },
  );
}

export function confirmLogout(): void {
  confirmAction('Terminar sessão', 'Tens a certeza que queres sair da tua conta?', 'Terminar sessão', () => {
    void logout();
  });
}
