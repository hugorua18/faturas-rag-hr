import AsyncStorage from '@react-native-async-storage/async-storage';

// Cache local (neste dispositivo) de nome + última categoria usada por NIF de
// prestador — evita esperar pelo servidor (histórico/VIES) para NIFs já
// vistos antes, incluindo quando o servidor gratuito está "a dormir"
// (arranque a frio ~50s), e pré-preenche a categoria da despesa com a última
// classificação registada para esse fornecedor (um fornecedor pode ter
// faturas de mais do que uma categoria ao longo do tempo — guarda-se sempre a
// mais recente, não um histórico). Guardado como um único blob JSON (não um
// item por NIF) porque é sempre lido por inteiro (autofill + ecrã "Fornecedores").
const STORAGE_KEY = 'supplier_cache_v2';

interface CachedSupplierRecord {
  name?: string;
  lastType?: string; // ExpenseType de @invoice-scanner/shared — guardado como string solta, tal como no resto da app
}

let cache: Record<string, CachedSupplierRecord> | undefined; // undefined = ainda não carregado do storage

async function loadCache(): Promise<Record<string, CachedSupplierRecord>> {
  if (cache) return cache;
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  try {
    cache = raw ? (JSON.parse(raw) as Record<string, CachedSupplierRecord>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

async function persist(): Promise<void> {
  if (!cache) return;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
}

export async function getCachedSupplierName(nif: string): Promise<string | null> {
  const map = await loadCache();
  return map[nif]?.name ?? null;
}

export async function setCachedSupplierName(nif: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const map = await loadCache();
  map[nif] = { ...map[nif], name: trimmed };
  await persist();
}

export async function getCachedSupplierType(nif: string): Promise<string | null> {
  const map = await loadCache();
  return map[nif]?.lastType ?? null;
}

export async function setCachedSupplierType(nif: string, type: string): Promise<void> {
  const map = await loadCache();
  map[nif] = { ...map[nif], lastType: type };
  await persist();
}

export interface CachedSupplier {
  nif: string;
  name: string;
  lastType?: string;
}

// Só devolve entradas com nome — a entrada pode existir só com `lastType`
// (ex: despesa de um NIF cujo nome nunca chegou a ficar em cache) e essas não
// fazem sentido no ecrã "Fornecedores", que lista por nome.
export async function listCachedSuppliers(): Promise<CachedSupplier[]> {
  const map = await loadCache();
  return Object.entries(map)
    .filter((entry): entry is [string, CachedSupplierRecord & { name: string }] => Boolean(entry[1].name))
    .map(([nif, record]) => ({ nif, name: record.name, lastType: record.lastType }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt'));
}

export async function removeCachedSupplier(nif: string): Promise<void> {
  const map = await loadCache();
  delete map[nif];
  await persist();
}

// Preenche o cache a partir do histórico do servidor (GET /suppliers/backfill)
// sem sobrepor NIFs já presentes localmente — nunca desfaz uma customização
// que o utilizador já tenha feito no ecrã "Fornecedores" ou um nome já
// aprendido pelo autofill ao vivo. Usado uma única vez (ver hooks/use-supplier-backfill.ts).
export async function mergeSupplierBackfill(
  entries: { nif: string; name: string; lastType?: string | null }[],
): Promise<void> {
  const map = await loadCache();
  let changed = false;
  for (const entry of entries) {
    if (map[entry.nif]) continue;
    map[entry.nif] = { name: entry.name, lastType: entry.lastType ?? undefined };
    changed = true;
  }
  if (changed) await persist();
}
