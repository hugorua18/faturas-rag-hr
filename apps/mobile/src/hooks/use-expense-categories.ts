import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExpenseCategory } from '@invoice-scanner/shared';

import { listCategories } from '@/api/client';
import { getCachedCategories, setCachedCategories } from '@/state/category-cache';

// Chamado uma vez no arranque da app (ver _layout.tsx) para a cópia local
// (state/category-cache.ts) já estar quente quando o utilizador chegar a um
// ecrã com o seletor "Tipo de despesa" — sem isto, cada scan/edição pagava o
// pedido ao servidor do zero, incluindo um eventual arranque a frio do
// Render (~50s), com o seletor vazio ou em carregamento entretanto.
export async function preloadExpenseCategories(): Promise<void> {
  try {
    const fresh = await listCategories();
    await setCachedCategories(fresh);
  } catch {
    // Falha em segundo plano no arranque: sem problema, o hook abaixo tenta
    // de novo (e mostra erro/recuo) quando um ecrã que precisa delas montar.
  }
}

// Categorias de despesa do utilizador com sessão iniciada — substitui os
// antigos EXPENSE_TYPES/EXPENSE_TYPE_LABELS fixos, que agora servem só como
// conjunto inicial ("seed") copiado para cada utilizador novo.
export function useExpenseCategories() {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Espelha `categories` de forma síncrona para o catch() de reload() poder
  // decidir "já há algo para mostrar?" sem depender de categories como
  // dependência do useCallback (isso recriaria reload() a cada atualização e
  // reexecutaria o efeito de montagem em loop).
  const categoriesRef = useRef<ExpenseCategory[]>([]);

  const applyCategories = useCallback((next: ExpenseCategory[]) => {
    categoriesRef.current = next;
    setCategories(next);
  }, []);

  // Sem .catch(), uma falha (servidor Render a acordar de um sono a frio,
  // rede móvel instável) deixava a rejeição por tratar: categories ficava
  // [] para sempre nesse ecrã, loading passava a false na mesma (parecendo
  // "carregado com sucesso, sem categorias") e o seletor de tipo de despesa
  // ficava vazio sem qualquer indicação — bloqueando a submissão da fatura,
  // já que o tipo é obrigatório.
  const reload = useCallback(() => {
    return listCategories()
      .then((fresh) => {
        setError(null);
        applyCategories(fresh);
        setCachedCategories(fresh).catch(() => {});
      })
      .catch((err) => {
        // Já há uma lista para mostrar (da cópia local ou de um pedido
        // anterior nesta sessão) — uma falha agora fica silenciosa, mantendo
        // o que já estava visível em vez de substituir por uma mensagem de
        // erro. Só mostra erro quando não há mesmo nada para mostrar.
        if (categoriesRef.current.length === 0) {
          setError(err instanceof Error ? err.message : 'Falha ao carregar categorias');
        }
      })
      .finally(() => setLoading(false));
  }, [applyCategories]);

  useEffect(() => {
    let cancelled = false;
    // Mostra já a cópia local (se existir) para o seletor não ficar vazio/a
    // rodar à espera do servidor — o pedido de rede a seguir corre na mesma,
    // atualizando em segundo plano com o valor fresco.
    getCachedCategories().then((cached) => {
      if (cancelled || !cached || cached.length === 0) return;
      applyCategories(cached);
      setLoading(false);
    });
    reload();
    return () => {
      cancelled = true;
    };
  }, [reload, applyCategories]);

  return { categories, loading, error, reload };
}
