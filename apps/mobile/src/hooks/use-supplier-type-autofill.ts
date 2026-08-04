import { useEffect, useRef } from 'react';
import type { ExpenseCategory } from '@invoice-scanner/shared';

import { getCachedSupplierType } from '@/state/supplier-cache';

// Pré-preenche a categoria da despesa com a última classificação registada
// para este NIF de prestador (cache local, ver supplier-cache.ts) — um
// fornecedor pode ter faturas de mais do que uma categoria ao longo do tempo,
// por isso usa-se sempre a mais recente, nunca sobrepondo uma categoria já
// escolhida. Só cache local, sem servidor — a categoria é uma conveniência
// puramente deste dispositivo, ao contrário do nome (que também vem de VIES).
// `categories` valida que a chave em cache ainda existe (pode ter sido
// renomeada/apagada pelo utilizador desde a última vez).
export function useSupplierTypeAutofill(
  supplierNif: string,
  type: string | null,
  setType: (value: string) => void,
  categories: ExpenseCategory[],
) {
  const typeRef = useRef(type);
  typeRef.current = type;
  const setTypeRef = useRef(setType);
  setTypeRef.current = setType;
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;

  useEffect(() => {
    const nif = supplierNif.trim();
    if (!/^\d{9}$/.test(nif) || typeRef.current !== null) return;

    let cancelled = false;
    getCachedSupplierType(nif).then((cachedType) => {
      if (cancelled || typeRef.current !== null || !cachedType) return;
      if (categoriesRef.current.some((c) => c.key === cachedType)) {
        setTypeRef.current(cachedType);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [supplierNif]);
}
