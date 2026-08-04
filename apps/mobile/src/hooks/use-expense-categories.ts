import { useCallback, useEffect, useState } from 'react';
import type { ExpenseCategory } from '@invoice-scanner/shared';

import { listCategories } from '@/api/client';

// Categorias de despesa do utilizador com sessão iniciada — substitui os
// antigos EXPENSE_TYPES/EXPENSE_TYPE_LABELS fixos, que agora servem só como
// conjunto inicial ("seed") copiado para cada utilizador novo.
export function useExpenseCategories() {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    return listCategories()
      .then(setCategories)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { categories, loading, reload };
}
