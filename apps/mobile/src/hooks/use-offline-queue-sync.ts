import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

import { createExpense, DuplicateExpenseError } from '@/api/client';
import {
  listQueuedSubmissions,
  markQueuedSubmissionError,
  queuedSubmissionCount,
  removeQueuedSubmission,
} from '@/state/offline-queue';

// Reenvia a fila de submissões offline (ver state/offline-queue.ts) assim que
// há ligação: ao ganhar conectividade (NetInfo) e sempre que a app volta para
// primeiro plano (AppState) — cobre tanto "a ligação voltou com a app aberta"
// como "a app estava em fundo quando a ligação voltou". Sequencial (não em
// paralelo): evita sobrecarregar um servidor Render a acordar de um arranque
// a frio com várias submissões em simultâneo.
export function useOfflineQueueSync(): { count: number; syncing: boolean; syncNow: () => Promise<void> } {
  const [count, setCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const runningRef = useRef(false);

  const refreshCount = useCallback(() => {
    queuedSubmissionCount()
      .then(setCount)
      .catch(() => {
        // O badge é só informativo — mantém o último valor conhecido.
      });
  }, []);

  const runSync = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setSyncing(true);
    try {
      const state = await NetInfo.fetch();
      if (state.isConnected === false || state.isInternetReachable === false) return;

      const items = await listQueuedSubmissions();
      for (const item of items) {
        try {
          const file = {
            uri: item.fileUri,
            name: `fatura.${item.fileMimeType.split('/')[1] ?? 'jpg'}`,
            mimeType: item.fileMimeType,
          };
          await createExpense(item.input, file);
          await removeQueuedSubmission(item.id);
        } catch (err) {
          // Duplicado: outro dispositivo/sessão já submeteu a mesma fatura
          // entretanto — trata como enviada em vez de insistir para sempre.
          if (err instanceof DuplicateExpenseError) {
            await removeQueuedSubmission(item.id);
            continue;
          }
          await markQueuedSubmissionError(item.id, err instanceof Error ? err.message : 'Falha ao reenviar');
          // Se esta falhou por rede, as seguintes vão falhar da mesma forma —
          // pára aqui em vez de as tentar todas já a seguir.
          break;
        }
      }
    } finally {
      setSyncing(false);
      runningRef.current = false;
      refreshCount();
    }
  }, [refreshCount]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    refreshCount();
    void runSync();

    const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) void runSync();
    });
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void runSync();
    });

    return () => {
      unsubscribeNetInfo();
      appStateSubscription.remove();
    };
  }, [runSync, refreshCount]);

  return { count, syncing, syncNow: runSync };
}
