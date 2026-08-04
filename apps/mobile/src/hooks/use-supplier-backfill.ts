import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { fetchSupplierBackfill } from '@/api/client';
import { mergeSupplierBackfill } from '@/state/supplier-cache';

// Corre uma única vez por instalação: traz do servidor o nome + última
// categoria de cada NIF de prestador já visto nas despesas submetidas, e
// junta-os ao cache local (sem sobrepor o que já lá estiver). Sem isto, um
// utilizador com faturas antigas só via o autofill funcionar depois de a
// primeira fatura de cada fornecedor voltar a passar pelo servidor.
const DONE_FLAG_KEY = 'supplier_cache_backfilled_v1';

let started = false; // evita disparar duas vezes na mesma sessão (ex: montado em dois ecrãs)

export function useSupplierBackfill(): void {
  useEffect(() => {
    if (started) return;
    started = true;
    void (async () => {
      try {
        const done = await AsyncStorage.getItem(DONE_FLAG_KEY);
        if (done) return;
        const entries = await fetchSupplierBackfill();
        await mergeSupplierBackfill(entries);
        await AsyncStorage.setItem(DONE_FLAG_KEY, '1');
      } catch {
        // Melhor tentar outra vez na próxima sessão do que nunca marcar como feito.
        started = false;
      }
    })();
  }, []);
}
