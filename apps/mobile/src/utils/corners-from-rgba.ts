/** Canto em coordenadas normalizadas (0..1) da imagem original. */
export interface NormalizedPoint {
  x: number;
  y: number;
}

const MIN_CONTRAST = 14; // diferença mínima centro/borda (0-255) para confiar na separação
const MIN_AREA_RATIO = 0.2; // o documento tem de cobrir ≥20% da foto…
const MAX_AREA_RATIO = 0.985; // …e não ser a foto inteira (aí não há nada a recortar)

// Núcleo puro (sem expo) — separado para poder ser testado em Node com
// buffers RGBA sintéticos.
export function cornersFromRgba(data: Uint8Array, w: number, h: number): NormalizedPoint[] | null {
  try {
    if (!w || !h || w * h > 100_000) return null;

    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      lum[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    }

    // Referências: fundo = moldura exterior (~6%), documento = zona central.
    const bw = Math.max(2, Math.round(w * 0.06));
    const bh = Math.max(2, Math.round(h * 0.06));
    let borderSum = 0;
    let borderCount = 0;
    let centerSum = 0;
    let centerCount = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x < bw || x >= w - bw || y < bh || y >= h - bh) {
          borderSum += lum[y * w + x];
          borderCount++;
        } else if (x > w * 0.35 && x < w * 0.65 && y > h * 0.35 && y < h * 0.65) {
          centerSum += lum[y * w + x];
          centerCount++;
        }
      }
    }
    if (!borderCount || !centerCount) return null;
    const borderMean = borderSum / borderCount;
    const centerMean = centerSum / centerCount;
    if (Math.abs(centerMean - borderMean) < MIN_CONTRAST) return null;

    // Classificação binária pelo protótipo mais próximo…
    const isDoc = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      isDoc[i] = Math.abs(lum[i] - centerMean) <= Math.abs(lum[i] - borderMean) ? 1 : 0;
    }
    // …com erosão simples para o ruído não "puxar" os cantos (um pixel só
    // conta se 7 dos 9 na vizinhança 3x3 também forem documento).
    const clean = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (!isDoc[y * w + x]) continue;
        let neighbours = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) neighbours += isDoc[(y + dy) * w + (x + dx)];
        }
        if (neighbours >= 7) clean[y * w + x] = 1;
      }
    }

    // Cantos do documento = pixels que minimizam a distância L1 a cada canto
    // da imagem (funciona também com o documento inclinado, ao contrário de
    // uma simples bounding box).
    let tl: { x: number; y: number } | null = null;
    let tr: { x: number; y: number } | null = null;
    let br: { x: number; y: number } | null = null;
    let bl: { x: number; y: number } | null = null;
    let dTl = Infinity;
    let dTr = Infinity;
    let dBr = Infinity;
    let dBl = Infinity;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!clean[y * w + x]) continue;
        const toTl = x + y;
        const toTr = w - 1 - x + y;
        const toBr = w - 1 - x + (h - 1 - y);
        const toBl = x + (h - 1 - y);
        if (toTl < dTl) [dTl, tl] = [toTl, { x, y }];
        if (toTr < dTr) [dTr, tr] = [toTr, { x, y }];
        if (toBr < dBr) [dBr, br] = [toBr, { x, y }];
        if (toBl < dBl) [dBl, bl] = [toBl, { x, y }];
      }
    }
    if (!tl || !tr || !br || !bl) return null;

    // Plausibilidade: área (shoelace) dentro dos limites e lados não degenerados.
    const quad = [tl, tr, br, bl];
    let area = 0;
    for (let i = 0; i < 4; i++) {
      const a = quad[i];
      const b = quad[(i + 1) % 4];
      area += a.x * b.y - b.x * a.y;
    }
    const areaRatio = Math.abs(area) / 2 / (w * h);
    if (areaRatio < MIN_AREA_RATIO || areaRatio > MAX_AREA_RATIO) return null;
    if (tr.x - tl.x < w * 0.3 || br.x - bl.x < w * 0.3) return null;
    if (bl.y - tl.y < h * 0.3 || br.y - tr.y < h * 0.3) return null;

    return quad.map((p) => ({ x: p.x / (w - 1), y: p.y / (h - 1) }));
  } catch {
    return null;
  }
}
