import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export const DEFAULT_ACQUIRER_NIF_ICON: IoniconName = 'business-outline';

// Escolha curta de ícones para diferenciar visualmente os teus NIFs de
// adquirente no ecrã "Escolha o NIF" (ex: "Pessoal" vs "Empresa").
export const ACQUIRER_NIF_ICON_CHOICES: IoniconName[] = [
  'business-outline',
  'person-outline',
  'briefcase-outline',
  'home-outline',
  'storefront-outline',
  'car-outline',
  'construct-outline',
  'medkit-outline',
  'wallet-outline',
  'star-outline',
];
