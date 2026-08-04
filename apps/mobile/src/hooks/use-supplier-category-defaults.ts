import { useCallback, useEffect, useState } from 'react';

import { listSupplierCategoryDefaults } from '@/api/client';

// Categorias por omissão por NIF de prestador — pré-preenchem o ecrã de
// validação/edição (sempre alteráveis fatura a fatura, ver
// use-supplier-type-autofill.ts). Só ficam definidas quando o utilizador
// confirma explicitamente o pedido "queres usar esta categoria como omissão?".
export function useSupplierCategoryDefaults() {
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    return listSupplierCategoryDefaults()
      .then(setDefaults)
      .catch(() => {
        // Sem rede/sessão: mantém os valores já carregados.
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { defaults, loading, reload };
}
