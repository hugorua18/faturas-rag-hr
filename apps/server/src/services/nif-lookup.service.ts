// Lookup do nome de uma entidade portuguesa a partir do NIF, via VIES — o
// registo oficial de números de IVA da UE (Comissão Europeia). Gratuito e sem
// chave de API; para NIFs PT devolve o nome legal registado. Nem todas as
// entidades constam (ex: particulares), por isso é sempre best-effort.
const VIES_REST_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms/PT/vat';
const LOOKUP_TIMEOUT_MS = 6000;

interface ViesResponse {
  isValid?: boolean;
  name?: string | null;
}

// O VIES devolve nomes em maiúsculas com espaçamento irregular e usa "---"
// quando o estado-membro não divulga o nome.
function tidyName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name || name === '---') return null;
  return name;
}

export async function lookupNifNameViaVies(nif: string): Promise<string | null> {
  const response = await fetch(`${VIES_REST_URL}/${encodeURIComponent(nif)}`, {
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const data = (await response.json()) as ViesResponse;
  if (!data.isValid || !data.name) return null;
  return tidyName(data.name);
}
