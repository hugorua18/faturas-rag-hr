import { useCallback, useEffect, useState } from 'react';

import { listSupplierVatDefaults } from '@/api/client';

// Valores de IVA dedutível aprendidos por NIF de prestador — só usados quando
// AccountVatSettings.vatAutoFillMode = "SUPPLIER" (ver use-vat-deductible-autofill.ts).
export function useSupplierVatDefaults() {
  const [defaults, setDefaults] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    return listSupplierVatDefaults()
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
