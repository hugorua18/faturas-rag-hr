import { useCallback, useEffect, useState } from 'react';
import type { AccountVatSettings } from '@invoice-scanner/shared';

import { getAccountVatSettings } from '@/api/client';

const DEFAULT_SETTINGS: AccountVatSettings = { vatClassificationEnabled: false, vatAutoFillMode: null };

// Definições de conta para a classificação de IVA dedutível — desativada por
// omissão, tal como no servidor (ver /account-settings), por isso o valor
// inicial (antes do primeiro pedido responder) nunca bloqueia o formulário.
export function useAccountVatSettings() {
  const [settings, setSettings] = useState<AccountVatSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    return getAccountVatSettings()
      .then(setSettings)
      .catch(() => {
        // Sem rede/sessão: mantém as definições já carregadas (ou a omissão desativada).
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { settings, loading, reload };
}
