import type { LevelPoint } from "./weekCapacity";

const W = 308;
const H = 118;
const PAD = { l: 28, r: 8, t: 14, b: 22 };

function weekday(t: number) {
  return new Date(t).toLocaleDateString("zh-TW", { weekday: "narrow", timeZone: "Asia/Taipei" });
}

export function WeekChart({ points }: { points: LevelPoint[] }) {
  if (points.length < 2) return null;
  const minT = points[0].t;
  const maxT = points[points.length - 1].t;
  const span = maxT - minT || 1;
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const x = (t: number) => PAD.l + ((t - minT) / span) * innerW;
  const y = (level: number) => PAD.t + (1 - level / 100) * innerH;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)} ${y(p.level).toFixed(1)}`).join(" ");
  const baseline = y(0);
  const area = `${d} L${x(points[points.length - 1].t).toFixed(1)} ${baseline.toFixed(1)} L${x(points[0].t).toFixed(1)} ${baseline.toFixed(1)} Z`;
  const y80 = y(80);

  const days: { t: number; label: string }[] = [];
  let previous = "";
  for (const point of points) {
    const label = weekday(point.t);
    if (label === previous) continue;
    days.push({ t: point.t, label });
    previous = label;
  }

  return (
    <svg className="week-chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="過去一週已滿百分比，虛線是 8 分滿">
      <path className="area" d={area} />
      <line className="threshold" x1={PAD.l} x2={W - PAD.r} y1={y80} y2={y80} />
      <text x="0" y={y(100) + 8}>100</text>
      <text x="4" y={y80 + 3}>80</text>
      <text x="8" y={y(0) - 2}>0</text>
      <path className="line" d={d} />
      {days.map((day, i) => (
        <text
          key={day.t}
          x={x(day.t)}
          y={H - 4}
          textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"}
        >
          {day.label}
        </text>
      ))}
    </svg>
  );
}
