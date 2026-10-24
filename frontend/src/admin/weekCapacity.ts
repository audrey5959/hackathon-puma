export interface LevelPoint {
  t: number;
  level: number;
}

const HOUR = 60 * 60 * 1000;
const WEEK = 7 * 24 * HOUR;
const TAIL = 12 * HOUR;
const FULL = 80;

export const restLevel = (binId: number) => 12 + ((binId * 17) % 34);

// 桶編號決定本週會爬幾次到 8 分滿。同一個編號每次算出來都一樣。
function fillsOf(binId: number) {
  return [0, 0, 1, 1, 2, 2, 3, 4][Math.abs(binId) % 8];
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 一週、每小時一點。會滿的桶先鋸齒爬升，最後 12 小時回到這個桶的低水位，右端再交給當下水位。
export function weekSeries(binId: number, now = Date.now()): LevelPoint[] {
  const end = Math.floor(now / HOUR) * HOUR;
  const start = end - WEEK;
  const rest = restLevel(binId);
  const rand = mulberry32(binId * 10007);
  const fills = fillsOf(binId);
  const points: LevelPoint[] = [];

  if (fills === 0) {
    const peak = 40 + rand() * 25;
    const peakAt = 0.35 + rand() * 0.3;
    for (let t = start; t <= end; t += HOUR) {
      const p = (t - start) / WEEK;
      const level = p < peakAt
        ? rest + (peak - rest) * (p / peakAt)
        : peak + (rest - peak) * ((p - peakAt) / (1 - peakAt));
      points.push({ t, level });
    }
    points[points.length - 1].level = rest;
    return points;
  }

  const lows: number[] = [];
  const highs: number[] = [];
  for (let i = 0; i < fills; i++) {
    lows.push(12 + rand() * 8);
    highs.push(86 + rand() * 9);
  }
  const cycle = (WEEK - TAIL) / fills;
  for (let t = start; t < end - TAIL; t += HOUR) {
    const elapsed = t - start;
    const index = Math.min(fills - 1, Math.floor(elapsed / cycle));
    const phase = (elapsed - index * cycle) / cycle;
    const low = lows[index];
    const high = highs[index];
    const level = phase < 0.82
      ? low + (high - low) * (phase / 0.82)
      : high + (low - high) * ((phase - 0.82) / 0.18);
    points.push({ t, level });
  }
  const tailFrom = points[points.length - 1].level;
  for (let t = end - TAIL; t <= end; t += HOUR) {
    const p = (t - (end - TAIL)) / TAIL;
    points.push({ t, level: tailFrom + (rest - tailFrom) * p });
  }
  points[points.length - 1].level = rest;
  return points;
}

export function withLiveLevel(points: LevelPoint[], live: number | null): LevelPoint[] {
  if (live === null || points.length === 0) return points;
  const next = points.slice();
  next[next.length - 1] = { t: next[next.length - 1].t, level: live };
  return next;
}

export function usageOf(points: LevelPoint[]) {
  let times = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i - 1].level < FULL && points[i].level >= FULL) times += 1;
  }
  const band = times >= 3 ? "high" : times >= 1 ? "mid" : "low";
  const label = band === "high" ? "容易滿" : band === "mid" ? "普通" : "少用";
  const detail = times === 0 ? "本週沒有到 8 分滿" : `本週 ${times} 次到 8 分滿`;
  return { times, band, label, detail };
}
