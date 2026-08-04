import { useEffect, useRef } from 'react';
import type { ExpenseCategory, VatAutoFillMode } from '@invoice-scanner/shared';

// Pré-preenche "IVA dedutível" a partir da fonte escolhida em
// AccountVatSettings.vatAutoFillMode — "SUPPLIER" usa o valor aprendido por
// NIF do prestador (ver use-supplier-vat-defaults.ts), "CATEGORY" usa o valor
// guardado na categoria escolhida (ExpenseCategory.vatDeductible). Nunca
// sobrepõe uma escolha já feita (manual ou de um preenchimento anterior nesta
// visita ao ecrã) — mesmo princípio de use-supplier-type-autofill.ts.
export function useVatDeductibleAutofill(
  mode: VatAutoFillMode,
  supplierNif: string,
  categoryKey: string | null,
  categories: ExpenseCategory[],
  supplierDefaults: Record<string, boolean>,
  vatDeductible: boolean | null,
  setVatDeductible: (value: boolean) => void,
) {
  const vatDeductibleRef = useRef(vatDeductible);
  vatDeductibleRef.current = vatDeductible;
  const setVatDeductibleRef = useRef(setVatDeductible);
  setVatDeductibleRef.current = setVatDeductible;

  useEffect(() => {
    if (vatDeductibleRef.current !== null) return;

    if (mode === 'SUPPLIER') {
      const nif = supplierNif.trim();
      if (!/^\d{9}$/.test(nif)) return;
      const value = supplierDefaults[nif];
      if (value !== undefined) setVatDeductibleRef.current(value);
    } else if (mode === 'CATEGORY') {
      if (!categoryKey) return;
      const value = categories.find((c) => c.key === categoryKey)?.vatDeductible;
      if (value !== null && value !== undefined) setVatDeductibleRef.current(value);
    }
  }, [mode, supplierNif, categoryKey, categories, supplierDefaults]);
}
