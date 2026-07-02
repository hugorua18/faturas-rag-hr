import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { listExpenses } from '@/api/client';

// Nº de despesas na fila "Tratamento manual" (chegadas por email, à espera de
// revisão) — alimenta o badge do envelope. Recarrega sempre que o ecrã ganha
// foco; falhas são silenciosas (o badge é informativo, não crítico).
export function usePendingCount(): number {
  const [count, setCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listExpenses({ status: 'TRATAMENTO_MANUAL' })
        .then((data) => {
          if (!cancelled) setCount(data.length);
        })
        .catch(() => {
          // Sem rede/sessão expirada: mantém o último valor em vez de rebentar.
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return count;
}
