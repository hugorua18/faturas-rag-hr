import { useEffect, useState } from 'react';
import { Image } from 'react-native';

// Enquanto o tamanho real não chega, assume uma proporção de retrato
// plausível para um talão — evita a caixa colapsar/saltar durante a carga.
const DEFAULT_ASPECT_RATIO = 0.72;

// Proporção largura/altura real da imagem, para a pré-visualização em ecrã
// largo poder mostrar o documento completo (sem cortar) em vez de uma altura
// fixa arbitrária — sobretudo importante em talões compridos e estreitos.
export function useImageAspectRatio(uri: string | null | undefined): number {
  const [ratio, setRatio] = useState(DEFAULT_ASPECT_RATIO);

  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    Image.getSize(
      uri,
      (width, height) => {
        if (!cancelled && width > 0 && height > 0) setRatio(width / height);
      },
      () => {
        // getSize falhou (ex: URL temporariamente inválido) — mantém a
        // proporção anterior/omissão, sem rebentar a UI.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [uri]);

  return ratio;
}
