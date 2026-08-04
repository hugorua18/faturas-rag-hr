import { useEffect, useRef, useState } from 'react';

import { lookupSupplierName } from '@/api/client';
import { getCachedSupplierName, setCachedSupplierName } from '@/state/supplier-cache';

// Preenche automaticamente o nome do prestador a partir do NIF, por ordem:
//   1. cache local (neste dispositivo) — instantâneo, sem rede;
//   2. servidor (histórico do utilizador → VIES) — só se o NIF não estiver
//      em cache; o nome devolvido fica guardado em cache para a próxima vez.
// Nunca sobrepõe texto escrito pelo utilizador: verifica que o nome continua
// vazio no momento em que a resposta chega. O passo de rede tem debounce de
// 600ms para não disparar a cada dígito enquanto o NIF está a ser escrito à
// mão; o cache local não precisa de debounce (é só memória/disco).
//
// Devolve "loading" para o ecrã poder mostrar que está à espera do servidor —
// mesmo uma consulta ao histórico (rápida, só a BD) pode demorar dezenas de
// segundos se o servidor gratuito (Render) tiver adormecido por inatividade;
// sem indicação visual, essa espera parece a app estar avariada. Nunca fica
// "loading" quando o nome vem do cache local.
export function useSupplierNameAutofill(
  supplierNif: string,
  supplierName: string,
  setSupplierName: (value: string) => void,
): boolean {
  const [loading, setLoading] = useState(false);
  const nameRef = useRef(supplierName);
  nameRef.current = supplierName;
  const setNameRef = useRef(setSupplierName);
  setNameRef.current = setSupplierName;

  useEffect(() => {
    const nif = supplierNif.trim();
    if (!/^\d{9}$/.test(nif) || nameRef.current.trim() !== '') {
      setLoading(false);
      return;
    }

    let cancelled = false;

    getCachedSupplierName(nif).then((cached) => {
      if (cancelled || !cached || nameRef.current.trim() !== '') return;
      setNameRef.current(cached);
    });

    const timer = setTimeout(() => {
      // Se o cache local já preencheu o nome entretanto, nem chega a pedir ao servidor.
      if (cancelled || nameRef.current.trim() !== '') return;
      setLoading(true);
      lookupSupplierName(nif)
        .then(({ name }) => {
          if (cancelled) return;
          if (name && nameRef.current.trim() === '') {
            setNameRef.current(name);
          }
          if (name) void setCachedSupplierName(nif, name);
        })
        .catch(() => {
          // Autofill é uma conveniência — falhas (rede, VIES em baixo) são silenciosas.
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [supplierNif]);

  return loading;
}
