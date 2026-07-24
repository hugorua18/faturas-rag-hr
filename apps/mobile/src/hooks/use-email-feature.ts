import { useEffect, useState } from 'react';
import { EMAIL_INGEST_ACCOUNT } from '@invoice-scanner/shared';

import { fetchCurrentUser } from '@/api/client';
import { getSessionEmail, getSessionToken, setSessionEmail } from '@/state/session';

// true quando a sessão atual é a conta da caixa de email. Sessões iniciadas
// antes de o email ficar guardado no storage são reparadas via /auth/me.
export function useEmailFeatureAvailable(): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let email = await getSessionEmail();
      if (!email && (await getSessionToken())) {
        try {
          const me = await fetchCurrentUser();
          email = me.email;
          await setSessionEmail(me.email);
        } catch {
          // Sem rede ou sessão inválida — a opção fica escondida; o guard de
          // sessão trata do resto.
        }
      }
      if (!cancelled) setAvailable((email ?? '').toLowerCase() === EMAIL_INGEST_ACCOUNT);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return available;
}
