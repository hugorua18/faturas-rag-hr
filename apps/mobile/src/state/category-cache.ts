import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ExpenseCategory } from '@invoice-scanner/shared';

// Cópia local (neste dispositivo) da lista de categorias do utilizador —
// evita esperar pelo servidor (incluindo um arranque a frio do Render, ~50s)
// sempre que um ecrã com o seletor "Tipo de despesa" abre. A lista muda
// pouco (só quando o utilizador cria/edita/remove uma categoria no ecrã
// Categorias), por isso mostrar a cópia local de imediato e atualizar em
// segundo plano com o valor fresco do servidor é seguro — na pior das
// hipóteses mostra por um instante uma categoria já removida ou falta uma
// recém-criada, corrigido assim que o pedido em segundo plano responder.
const STORAGE_KEY = 'expense_categories_cache_v1';

let cache: ExpenseCategory[] | undefined; // undefined = ainda não lido do storage nesta sessão

export async function getCachedCategories(): Promise<ExpenseCategory[] | null> {
  if (cache) return cache;
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ExpenseCategory[];
    cache = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export async function setCachedCategories(categories: ExpenseCategory[]): Promise<void> {
  cache = categories;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(categories));
}
