/** Canto em coordenadas normalizadas (0..1) da imagem original. */
export interface NormalizedPoint {
  x: number;
  y: number;
}

interface Pt {
  x: number;
  y: number;
}

interface Pixels {
  w: number;
  h: number;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  lum: Float32Array;
}

const MIN_AREA_RATIO = 0.15; // o documento tem de cobrir ≥15% da foto…
const MAX_AREA_RATIO = 0.985; // …e não ser a foto inteira (aí não há nada a recortar)
const MIN_SCORE = 18; // contraste mínimo dentro/fora nas arestas para confiar no resultado
const LEGACY_MIN_CONTRAST = 14;

// Deteção dos 4 cantos de uma fatura numa foto reduzida (núcleo puro, sem
// expo — testável em Node com buffers RGBA).
//
// Estratégia principal ("papel branco"): uma fatura é quase sempre papel
// claro e pouco saturado. Procura-se a zona MAIS BRANCA da foto (com ligeira
// preferência pelo centro), tira-se daí a cor de referência do papel, marca-se
// cada pixel com cor parecida, fica-se com a mancha ligada a essa zona e
// ajusta-se-lhe o melhor quadrilátero (4 cantos — a perspetiva da foto
// raramente deixa um retângulo perfeito). Cada lado é depois afinado com uma
// reta ajustada aos pixels da aresta, o que corrige cantos arredondados,
// dobrados ou tapados por um dedo.
//
// Há ainda o algoritmo antigo (contraste de luminância centro/borda) como
// segundo candidato. Ganha o candidato com melhor pontuação: contraste de cor
// entre o interior e o exterior ao longo das arestas, penalizado quando os 4
// cantos (lado de dentro) não têm cor parecida entre si — num documento bem
// detetado os 4 cantos são todos "papel".
export function cornersFromRgba(data: Uint8Array, w: number, h: number): NormalizedPoint[] | null {
  try {
    if (!w || !h || w * h > 100_000 || w < 16 || h < 16) return null;
    const px = toPixels(data, w, h);

    const scored: { quad: Pt[]; score: number; area: number }[] = [];
    for (const candidate of [...quadsByPaperColour(px), quadByLuminance(px)]) {
      if (!candidate) continue;
      const quad = orderQuad(candidate.map((p) => clampPt(p, w, h)));
      if (!isPlausible(quad, w, h)) continue;
      scored.push({ quad, score: scoreQuad(px, quad), area: Math.abs(polygonArea(quad)) });
    }
    const top = Math.max(-Infinity, ...scored.map((c) => c.score));
    if (top < MIN_SCORE) return null;
    // Entre candidatos quase tão bons como o melhor, fica o maior: os limiares
    // mais apertados tendem a "comer" um canto (ex.: no cabeçalho escuro da
    // fatura) e o resultado é sempre um subconjunto do documento verdadeiro.
    let best = scored[0];
    for (const c of scored) {
      if (c.score >= top * 0.85 && (best.score < top * 0.85 || c.area > best.area)) best = c;
    }
    return best.quad.map((p) => ({ x: p.x / (w - 1), y: p.y / (h - 1) }));
  } catch {
    return null;
  }
}

function toPixels(data: Uint8Array, w: number, h: number): Pixels {
  const n = w * h;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    r[i] = data[o];
    g[i] = data[o + 1];
    b[i] = data[o + 2];
    lum[i] = 0.299 * r[i] + 0.587 * g[i] + 0.114 * b[i];
  }
  return { w, h, r, g, b, lum };
}

// ---------------------------------------------------------------------------
// Candidato 1: segmentação pela cor do papel
// ---------------------------------------------------------------------------

function quadsByPaperColour(px: Pixels): Pt[][] {
  const { w, h, r, g, b, lum } = px;
  const n = w * h;

  // 1. "Brancura": claro e pouco saturado (o texto e fundos coloridos descem).
  const white = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const mx = Math.max(r[i], g[i], b[i]);
    const mn = Math.min(r[i], g[i], b[i]);
    white[i] = lum[i] - 1.5 * (mx - mn);
  }

  // 2. Zona mais branca = máximo da brancura média numa janela (o texto
  //    impresso baixa pouco a média de uma janela grande de papel), com
  //    ligeira preferência pelo centro, onde o utilizador costuma pôr a fatura.
  const rad = Math.max(2, Math.round(Math.min(w, h) * 0.06));
  const blurred = boxBlur(white, w, h, rad);
  let seed = -1;
  let seedScore = -Infinity;
  const mx0 = Math.round(w * 0.05);
  const my0 = Math.round(h * 0.05);
  for (let y = my0; y < h - my0; y++) {
    for (let x = mx0; x < w - mx0; x++) {
      const dx = (x / (w - 1)) * 2 - 1;
      const dy = (y / (h - 1)) * 2 - 1;
      const s = blurred[y * w + x] - 45 * Math.sqrt((dx * dx + dy * dy) / 2);
      if (s > seedScore) {
        seedScore = s;
        seed = y * w + x;
      }
    }
  }
  if (seed < 0) return [];

  // 3. Cor de referência do papel: média da metade mais branca dos pixels da
  //    janela à volta da semente (exclui o texto).
  const sx = seed % w;
  const sy = (seed - sx) / w;
  const win: number[] = [];
  for (let y = Math.max(0, sy - rad); y <= Math.min(h - 1, sy + rad); y++) {
    for (let x = Math.max(0, sx - rad); x <= Math.min(w - 1, sx + rad); x++) win.push(y * w + x);
  }
  win.sort((i, j) => white[j] - white[i]);
  const top = win.slice(0, Math.max(1, Math.floor(win.length / 2)));
  let pr = 0;
  let pg = 0;
  let pb = 0;
  for (const i of top) {
    pr += r[i];
    pg += g[i];
    pb += b[i];
  }
  pr /= top.length;
  pg /= top.length;
  pb /= top.length;
  const pl = 0.299 * pr + 0.587 * pg + 0.114 * pb;

  // 4. Distância de cada pixel à cor do papel. A sombra/iluminação desigual
  //    escurece o papel sem lhe mudar o tom, por isso escurecer pesa menos do
  //    que mudar de cor (cromaticidade).
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cr = r[i] - lum[i] - (pr - pl);
    const cg = g[i] - lum[i] - (pg - pl);
    const cb = b[i] - lum[i] - (pb - pl);
    const dl = lum[i] - pl;
    const dLum = dl < 0 ? -dl * 0.75 : dl * 0.3;
    dist[i] = Math.sqrt(2.5 * (cr * cr + cg * cg + cb * cb) + dLum * dLum);
  }

  // 5. Limiares candidatos. Uma foto tem normalmente 3 grupos (papel, fundo,
  //    texto); o Otsu global pode separar o texto de tudo o resto, por isso
  //    tenta-se também o Otsu só dentro do grupo mais claro e alguns limiares
  //    fixos — a pontuação das arestas escolhe o melhor no fim.
  const t1 = otsu(dist);
  const lower = dist.filter((v) => v <= t1);
  const thresholds = [t1, lower.length > 50 ? otsu(lower) : t1, 22, 34, 50]
    .map((t) => Math.round(clamp(t, 14, 90)))
    .filter((t, i, all) => all.indexOf(t) === i);

  const quads: Pt[][] = [];
  for (const t of thresholds) {
    const q = quadFromMask(dist, t, w, h, sx, sy, rad);
    if (q) quads.push(q);
  }
  return quads;
}

function quadFromMask(
  dist: Float32Array,
  t: number,
  w: number,
  h: number,
  sx: number,
  sy: number,
  rad: number,
): Pt[] | null {
  const n = w * h;
  let mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = dist[i] <= t ? 1 : 0;

  // 6. Fecho (tapa as linhas de texto) e abertura (corta pontes finas para
  //    fundos parecidos com o papel).
  mask = erode(dilate(dilate(mask, w, h), w, h), w, h);
  mask = erode(mask, w, h);
  mask = dilate(erode(mask, w, h), w, h);
  mask = dilate(mask, w, h);

  // 7. Mancha ligada à semente (ou ao pixel de papel mais próximo dela).
  let start = sy * w + sx;
  if (!mask[start]) {
    start = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      const x = i % w;
      const y = (i - x) / w;
      const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (d < bestD) {
        bestD = d;
        start = i;
      }
    }
    if (start < 0 || bestD > (rad * 2) ** 2) return null;
  }
  const comp = component(mask, w, h, start);

  // 8. Pontos de contorno exterior (extremos por linha e por coluna).
  const boundary = outerBoundary(comp, w, h);
  if (boundary.length < 12) return null;

  // 9. Melhor quadrilátero inscrito no invólucro convexo + afinação dos lados.
  const hull = simplifyHull(convexHull(boundary), 28);
  if (hull.length < 4) return null;
  return refineSides(maxAreaQuad(hull), boundary, w, h);
}

// ---------------------------------------------------------------------------
// Candidato 2: algoritmo antigo (contraste de luminância centro/borda)
// ---------------------------------------------------------------------------

function quadByLuminance(px: Pixels): Pt[] | null {
  const { w, h, lum } = px;
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
  if (Math.abs(centerMean - borderMean) < LEGACY_MIN_CONTRAST) return null;

  const isDoc = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    isDoc[i] = Math.abs(lum[i] - centerMean) <= Math.abs(lum[i] - borderMean) ? 1 : 0;
  }
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

  let tl: Pt | null = null;
  let tr: Pt | null = null;
  let br: Pt | null = null;
  let bl: Pt | null = null;
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
  return [tl, tr, br, bl];
}

// ---------------------------------------------------------------------------
// Validação e pontuação
// ---------------------------------------------------------------------------

function isPlausible(q: Pt[], w: number, h: number): boolean {
  const areaRatio = Math.abs(polygonArea(q)) / (w * h);
  if (areaRatio < MIN_AREA_RATIO || areaRatio > MAX_AREA_RATIO) return false;
  const minSide = Math.min(w, h) * 0.25;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    if (Math.hypot(b.x - a.x, b.y - a.y) < minSide) return false;
    // Convexo e com ângulos de "retângulo em perspetiva" (40°–140°).
    const ux = a.x - b.x;
    const uy = a.y - b.y;
    const vx = c.x - b.x;
    const vy = c.y - b.y;
    const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
    if (Math.abs(cos) > Math.cos((40 * Math.PI) / 180)) return false;
    if (cross(a, b, c) <= 0) return false;
  }
  return true;
}

// Contraste de cor entre o lado de dentro e o de fora ao longo de cada aresta,
// menos a dispersão de cor dos 4 cantos (lado de dentro).
function scoreQuad(px: Pixels, q: Pt[]): number {
  const { w, h } = px;
  const off = Math.max(1.5, Math.min(w, h) * 0.03);
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;

  const sideScores: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / len;
    let ny = (b.x - a.x) / len;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    if (nx * (cx - mx) + ny * (cy - my) < 0) {
      nx = -nx;
      ny = -ny;
    }
    const diffs: number[] = [];
    for (let k = 1; k < 20; k++) {
      const t = 0.1 + (0.8 * k) / 20;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const inside = sample(px, x + nx * off, y + ny * off);
      const outside = sample(px, x - nx * off, y - ny * off);
      if (!inside || !outside) continue;
      // Também mais longe para fora: numa aresta falsa (ex.: o cabeçalho
      // preto da fatura) o lado de fora volta a ser papel logo a seguir.
      const far = sample(px, x - nx * off * 3.5, y - ny * off * 3.5);
      const d = colourDist(inside, outside);
      diffs.push(far ? Math.min(d, colourDist(inside, far)) : d);
    }
    if (diffs.length >= 5) sideScores.push(median(diffs));
  }
  if (sideScores.length < 2) return 0;
  // Lados encostados à moldura (sem "fora" para comparar) contam meio lado
  // com contraste nulo: aceita-se papel a sair da foto, mas não se premeia.
  const edge =
    sideScores.reduce((s, v) => s + v, 0) / (sideScores.length + 0.5 * (4 - sideScores.length));

  // Os 4 cantos vistos por dentro devem ser todos "papel" (cor parecida).
  const inset = Math.max(2, Math.min(w, h) * 0.05);
  const cornerCols: [number, number, number][] = [];
  for (const p of q) {
    const d = Math.hypot(cx - p.x, cy - p.y) || 1;
    const c = sample(px, p.x + ((cx - p.x) / d) * inset, p.y + ((cy - p.y) / d) * inset);
    if (c) cornerCols.push(c);
  }
  let spread = 0;
  if (cornerCols.length >= 2) {
    const m: [number, number, number] = [0, 0, 0];
    for (const c of cornerCols) for (let k = 0; k < 3; k++) m[k] += c[k] / cornerCols.length;
    for (const c of cornerCols) spread += colourDist(c, m) / cornerCols.length;
  }
  return edge - 0.5 * spread;
}

function sample(px: Pixels, x: number, y: number): [number, number, number] | null {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= px.w || yi >= px.h) return null;
  // Média 3x3 para não depender de um único pixel (texto, ruído).
  let r = 0;
  let g = 0;
  let b = 0;
  let c = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const xx = xi + dx;
      const yy = yi + dy;
      if (xx < 0 || yy < 0 || xx >= px.w || yy >= px.h) continue;
      const i = yy * px.w + xx;
      r += px.r[i];
      g += px.g[i];
      b += px.b[i];
      c++;
    }
  }
  return [r / c, g / c, b / c];
}

function colourDist(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// ---------------------------------------------------------------------------
// Geometria
// ---------------------------------------------------------------------------

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function polygonArea(p: Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

// Ordem do perímetro usada pelo ecrã de recorte: topo-esq, topo-dir,
// baixo-dir, baixo-esq (sentido horário no ecrã, com y para baixo).
function orderQuad(q: Pt[]): Pt[] {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const sorted = [...q].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  let first = 0;
  for (let i = 1; i < 4; i++) {
    if (sorted[i].x + sorted[i].y < sorted[first].x + sorted[first].y) first = i;
  }
  return [0, 1, 2, 3].map((k) => sorted[(first + k) % 4]);
}

function clampPt(p: Pt, w: number, h: number): Pt {
  return { x: clamp(p.x, 0, w - 1), y: clamp(p.y, 0, h - 1) };
}

// Invólucro convexo (monotone chain), sentido horário no ecrã.
function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// Reduz o invólucro removendo repetidamente o vértice que menos área
// contribui (Visvalingam), para a procura exaustiva do quadrilátero ser rápida.
function simplifyHull(hull: Pt[], maxPoints: number): Pt[] {
  const pts = [...hull];
  while (pts.length > maxPoints) {
    let worst = 0;
    let worstArea = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const c = pts[(i + 1) % pts.length];
      const area = Math.abs(cross(a, pts[i], c));
      if (area < worstArea) {
        worstArea = area;
        worst = i;
      }
    }
    pts.splice(worst, 1);
  }
  return pts;
}

// Quadrilátero de área máxima com vértices no invólucro (≤28 pontos → ~20k
// combinações, desprezável).
function maxAreaQuad(hull: Pt[]): Pt[] {
  const n = hull.length;
  if (n === 4) return hull;
  let best: Pt[] = hull.slice(0, 4);
  let bestArea = -1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        for (let l = k + 1; l < n; l++) {
          const area = Math.abs(polygonArea([hull[i], hull[j], hull[k], hull[l]]));
          if (area > bestArea) {
            bestArea = area;
            best = [hull[i], hull[j], hull[k], hull[l]];
          }
        }
      }
    }
  }
  return best;
}

// Afina cada lado com uma reta (mínimos quadrados totais) ajustada aos pontos
// de contorno perto desse lado, ignorando as pontas (cantos arredondados ou
// dobrados), e recalcula cada canto como a interseção de lados adjacentes.
function refineSides(quad: Pt[], boundary: Pt[], w: number, h: number): Pt[] {
  const diag = Math.hypot(w, h);
  const band = Math.max(2, diag * 0.03);
  const lines: ({ px: number; py: number; dx: number; dy: number } | null)[] = [];
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) {
      lines.push(null);
      continue;
    }
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    let pts = boundary.filter((p) => {
      const t = ((p.x - a.x) * ux + (p.y - a.y) * uy) / len;
      const d = Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux);
      return t > 0.12 && t < 0.88 && d <= band;
    });
    let line = fitLine(pts);
    if (line) {
      // Segunda passagem sem os pontos mais afastados da primeira reta.
      const l = line;
      pts = pts.filter((p) => Math.abs((p.x - l.px) * l.dy - (p.y - l.py) * l.dx) <= 1.5);
      line = fitLine(pts) ?? line;
    }
    lines.push(line);
  }

  const maxMove = diag * 0.06;
  return quad.map((corner, i) => {
    const l1 = lines[(i + 3) % 4];
    const l2 = lines[i];
    if (!l1 || !l2) return corner;
    const p = intersect(l1, l2);
    if (!p || Math.hypot(p.x - corner.x, p.y - corner.y) > maxMove) return corner;
    return p;
  });
}

function fitLine(pts: Pt[]): { px: number; py: number; dx: number; dy: number } | null {
  if (pts.length < 6) return null;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { px: mx, py: my, dx: Math.cos(angle), dy: Math.sin(angle) };
}

function intersect(
  a: { px: number; py: number; dx: number; dy: number },
  b: { px: number; py: number; dx: number; dy: number },
): Pt | null {
  const det = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(det) < 0.2) return null; // quase paralelas
  const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / det;
  return { x: a.px + a.dx * t, y: a.py + a.dy * t };
}

// ---------------------------------------------------------------------------
// Imagem binária / estatística
// ---------------------------------------------------------------------------

function boxBlur(src: Float32Array, w: number, h: number, rad: number): Float32Array {
  const integ = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      integ[(y + 1) * (w + 1) + (x + 1)] = integ[y * (w + 1) + (x + 1)] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - rad);
    const y1 = Math.min(h, y + rad + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - rad);
      const x1 = Math.min(w, x + rad + 1);
      const s =
        integ[y1 * (w + 1) + x1] -
        integ[y0 * (w + 1) + x1] -
        integ[y1 * (w + 1) + x0] +
        integ[y0 * (w + 1) + x0];
      out[y * w + x] = s / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

function otsu(values: Float32Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < values.length; i++) hist[Math.min(255, Math.max(0, Math.round(values[i])))]++;
  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const v = wB * wF * (mB - mF) ** 2;
    if (v > bestVar) {
      bestVar = v;
      best = t;
    }
  }
  return best;
}

function dilate(m: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dy = -1; dy <= 1 && !v; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && m[yy * w + xx]) {
            v = 1;
            break;
          }
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

function erode(m: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1;
      for (let dy = -1; dy <= 1 && v; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue; // a moldura da foto não "come" o documento
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && !m[yy * w + xx]) {
            v = 0;
            break;
          }
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

function component(m: Uint8Array, w: number, h: number, start: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const stack = [start];
  out[start] = 1;
  const visit = (j: number) => {
    if (m[j] && !out[j]) {
      out[j] = 1;
      stack.push(j);
    }
  };
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (y > 0) visit(i - w);
    if (y < h - 1) visit(i + w);
  }
  return out;
}

function outerBoundary(m: Uint8Array, w: number, h: number): Pt[] {
  const pts: Pt[] = [];
  for (let y = 0; y < h; y++) {
    let lo = -1;
    let hi = -1;
    for (let x = 0; x < w; x++) {
      if (m[y * w + x]) {
        if (lo < 0) lo = x;
        hi = x;
      }
    }
    if (lo >= 0) pts.push({ x: lo, y }, { x: hi, y });
  }
  for (let x = 0; x < w; x++) {
    let lo = -1;
    let hi = -1;
    for (let y = 0; y < h; y++) {
      if (m[y * w + x]) {
        if (lo < 0) lo = y;
        hi = y;
      }
    }
    if (lo >= 0) pts.push({ x, y: lo }, { x, y: hi });
  }
  return pts;
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
