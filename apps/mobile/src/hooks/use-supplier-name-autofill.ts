import { useEffect, useRef } from 'react';

import { lookupSupplierName } from '@/api/client';

// Preenche automaticamente o nome do prestador a partir do NIF (histórico do
// utilizador → VIES), quando o campo do nome está vazio. Nunca sobrepõe texto
// escrito pelo utilizador: verifica que o nome continua vazio no momento em
// que a resposta chega. Debounce de 600ms para não disparar a cada dígito
// enquanto o NIF está a ser escrito à mão.
export function useSupplierNameAutofill(
  supplierNif: string,
  supplierName: string,
  setSupplierName: (value: string) => void,
) {
  const nameRef = useRef(supplierName);
  nameRef.current = supplierName;
  const setNameRef = useRef(setSupplierName);
  setNameRef.current = setSupplierName;

  useEffect(() => {
    const nif = supplierNif.trim();
    if (!/^\d{9}$/.test(nif) || nameRef.current.trim() !== '') return;

    const timer = setTimeout(() => {
      lookupSupplierName(nif)
        .then(({ name }) => {
          if (name && nameRef.current.trim() === '') {
            setNameRef.current(name);
          }
        })
        .catch(() => {
          // Autofill é uma conveniência — falhas (rede, VIES em baixo) são silenciosas.
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [supplierNif]);
}
