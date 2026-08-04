import { useEffect, useRef } from 'react';
import type { ExpenseCategory } from '@invoice-scanner/shared';

import { getCachedSupplierType } from '@/state/supplier-cache';

// Pré-preenche a categoria da despesa a partir da fonte mais fiável
// disponível: primeiro a categoria por omissão do fornecedor guardada no
// servidor (categoryDefaults, ver use-supplier-category-defaults.ts —
// sincroniza entre dispositivos, só fica definida quando o utilizador
// confirma o pedido "queres usar esta categoria como omissão?"), e só na
// ausência dela recua para a última classificação usada em cache local
// (fornecedores vistos antes desta funcionalidade existir, ou offline).
// Nunca sobrepõe uma categoria já escolhida. `categories` valida que a chave
// ainda existe (pode ter sido apagada entretanto).
export function useSupplierTypeAutofill(
  supplierNif: string,
  type: string | null,
  setType: (value: string) => void,
  categories: ExpenseCategory[],
  categoryDefaults: Record<string, string>,
  categoryDefaultsLoading: boolean,
) {
  const typeRef = useRef(type);
  typeRef.current = type;
  const setTypeRef = useRef(setType);
  setTypeRef.current = setType;
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;

  useEffect(() => {
    // Espera a lista de omissões do servidor carregar antes de recuar para o
    // cache local — sem isto, uma resposta lenta deixava o cache local
    // "ganhar" a corrida mesmo quando o servidor tinha um valor diferente.
    if (categoryDefaultsLoading) return;
    const nif = supplierNif.trim();
    if (!/^\d{9}$/.test(nif) || typeRef.current !== null) return;

    const serverDefault = categoryDefaults[nif];
    if (serverDefault) {
      if (categoriesRef.current.some((c) => c.key === serverDefault)) {
        setTypeRef.current(serverDefault);
      }
      return;
    }

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
  }, [supplierNif, categoryDefaults, categoryDefaultsLoading]);
}
