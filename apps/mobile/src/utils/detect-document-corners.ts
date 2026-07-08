import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { toByteArray } from 'base64-js';
import jpeg from 'jpeg-js';

import { cornersFromRgba, type NormalizedPoint } from './corners-from-rgba';

export type { NormalizedPoint };

// Deteção de contornos do documento 100% local (sem rede): reduz a foto para
// ~96px (expo-image-manipulator, nativo e rápido), descodifica os pixels com
// jpeg-js e separa documento/fundo pelo contraste de luminância — um talão é
// tipicamente papel claro sobre fundo mais escuro (ou o inverso). Devolve os
// 4 cantos na ordem do perímetro usada pelo ecrã de recorte (topo-esq,
// topo-dir, baixo-dir, baixo-esq), ou null quando a confiança é baixa (pouco
// contraste, quadrilátero implausível) — nesse caso o recorte mantém as
// margens por omissão e o utilizador ajusta à mão, como antes.
// O núcleo do algoritmo vive em corners-from-rgba.ts (puro, testável em Node).
const TARGET_WIDTH = 96;

export async function detectDocumentCorners(uri: string): Promise<NormalizedPoint[] | null> {
  try {
    const small = await manipulateAsync(uri, [{ resize: { width: TARGET_WIDTH } }], {
      base64: true,
      compress: 0.7,
      format: SaveFormat.JPEG,
    });
    if (!small.base64) return null;

    const { width, height, data } = jpeg.decode(toByteArray(small.base64), { useTArray: true });
    return cornersFromRgba(data, width, height);
  } catch {
    return null;
  }
}
