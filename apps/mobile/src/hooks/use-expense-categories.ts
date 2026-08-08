import { useCallback, useEffect, useState } from 'react';
import type { ExpenseCategory } from '@invoice-scanner/shared';

import { listCategories } from '@/api/client';

// Categorias de despesa do utilizador com sessão iniciada — substitui os
// antigos EXPENSE_TYPES/EXPENSE_TYPE_LABELS fixos, que agora servem só como
// conjunto inicial ("seed") copiado para cada utilizador novo.
export function useExpenseCategories() {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sem .catch(), uma falha (servidor Render a acordar de um sono a frio,
  // rede móvel instável) deixava a rejeição por tratar: categories ficava
  // [] para sempre nesse ecrã, loading passava a false na mesma (parecendo
  // "carregado com sucesso, sem categorias") e o seletor de tipo de despesa
  // ficava vazio sem qualquer indicação — bloqueando a submissão da fatura,
  // já que o tipo é obrigatório.
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    return listCategories()
      .then(setCategories)
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Falha ao carregar categorias');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { categories, loading, error, reload };
}
