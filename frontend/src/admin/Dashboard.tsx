import { BINS, binById, KIND_LABEL, usePoll, type Case, type Kind, type Status } from "../shared/api";

const DISTRICT_ORDER = ["中正區", "大同區", "中山區", "松山區", "大安區", "萬華區", "信義區", "士林區", "北投區", "內湖區", "南港區", "文山區"];

function elapsed(utc: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(`${utc.replace(" ", "T")}Z`).getTime()) / 60000));
  if (minutes < 1) return "不到 1 分鐘";
  if (minutes < 60) return `${minutes} 分鐘`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 小時` : `${hours} 小時 ${rest} 分鐘`;
}

function tally(cases: Case[], status: Status) {
  return cases.filter((c) => c.status === status).length;
}

function districts(cases: Case[]) {
  const rows = new Map<string, { name: string; bins: number; open: number; assigned: number; done: number }>();
  for (const bin of BINS) {
    const name = bin.properties.district;
    const row = rows.get(name) ?? { name, bins: 0, open: 0, assigned: 0, done: 0 };
    row.bins += 1;
    rows.set(name, row);
  }
  for (const item of cases) {
    const row = rows.get(binById(item.bin_id)?.properties.district ?? "");
    if (row) row[item.status] += 1;
  }
  const rank = (name: string) => {
    const index = DISTRICT_ORDER.indexOf(name);
    return index === -1 ? DISTRICT_ORDER.length : index;
  };
  return [...rows.values()].sort((a, b) => {
    const pending = b.open + b.assigned - (a.open + a.assigned);
    return pending !== 0 ? pending : rank(a.name) - rank(b.name);
  });
}

function Mix({ open, assigned, done }: { open: number; assigned: number; done: number }) {
  if (open + assigned + done === 0) return <span className="mix" />;
  return (
    <span className="mix">
      {open > 0 && <i className="open" style={{ flex: open }} />}
      {assigned > 0 && <i className="assigned" style={{ flex: assigned }} />}
      {done > 0 && <i className="done" style={{ flex: done }} />}
    </span>
  );
}

export default function Dashboard() {
  const [cases] = usePoll<Case[]>("/api/cases");
  const list = cases ?? [];
  const open = tally(list, "open");
  const assigned = tally(list, "assigned");
  const done = tally(list, "done");
  const pending = list
    .filter((c) => c.status !== "done")
    .sort((a, b) => Number(a.status !== "open") - Number(b.status !== "open") || a.opened_at.localeCompare(b.opened_at));
  const oldest = pending[0];
  const sensor = list.reduce((sum, c) => sum + Number(c.sensor_reports || 0), 0);
  const citizen = list.reduce((sum, c) => sum + Number(c.citizen_reports || 0), 0);

  return (
    <main className="dashboard">
      <div className="dash-head">
        <div>
          <h1>清潔狀態</h1>
          <p className="muted">全市 {BINS.length} 座桶。數字每 2 秒跟著案件更新。</p>
        </div>
        <p className="key">
          <span><i className="swatch open" />待處理</span>
          <span><i className="swatch assigned" />已指派</span>
          <span><i className="swatch done" />已完成</span>
        </p>
      </div>

      {!cases && <p className="muted">讀取案件中…</p>}

      <section className="stats" aria-label="案件統計">
        <article className="stat need">
          <span>需要處理</span>
          <b>{open + assigned}</b>
          <span className="muted">待處理 {open} · 已指派 {assigned}</span>
        </article>
        <article className="stat open">
          <span>待處理</span>
          <b>{open}</b>
          <span className="muted">還沒指派清潔隊</span>
        </article>
        <article className="stat assigned">
          <span>已指派</span>
          <b>{assigned}</b>
          <span className="muted">清潔隊處理中</span>
        </article>
        <article className="stat done">
          <span>已完成</span>
          <b>{done}</b>
          <span className="muted">感測器 {sensor} · 民眾 {citizen}</span>
        </article>
      </section>

      <div className="board">
        <section className="card">
          <h2>各區清潔狀態</h2>
          <p className="muted">未完成較多的行政區排在前面。點一區可回到待辦地圖。</p>
          <div className="district-list">
            {districts(list).map((row) => {
              const unfinished = row.open + row.assigned;
              return (
                <a key={row.name} className="district-row" href={`/?district=${encodeURIComponent(row.name)}`}>
                  <b>{row.name}</b>
                  <Mix open={row.open} assigned={row.assigned} done={row.done} />
                  <span className="district-meta">
                    {unfinished > 0 ? `未完成 ${unfinished}` : row.done > 0 ? `已完成 ${row.done}` : "沒有案件"}
                    <span> · {row.bins} 座</span>
                  </span>
                </a>
              );
            })}
          </div>
        </section>

        <section className="card">
          <div className="row">
            <h2>尚未完成</h2>
            {oldest && <span className="muted">最久 {elapsed(oldest.opened_at)}</span>}
          </div>
          {cases && pending.length === 0 && (
            <p className="muted">目前沒有待清潔的案件。到<a href="/">待辦</a>按「模擬感測器」，或用市民回報頁建立案件。</p>
          )}
          <ul className="cases">
            {pending.map((c) => {
              const bin = binById(c.bin_id);
              const district = bin?.properties.district ?? "";
              return (
                <li key={c.id} className={c.status}>
                  <a href={`/?district=${encodeURIComponent(district)}&bin=${c.bin_id}`}>
                    <div className="row">
                      <b>#{c.id} {c.status === "open" ? "待處理" : "已指派"}</b>
                      <span className="muted">等待 {elapsed(c.opened_at)}</span>
                    </div>
                    <div>{bin ? `${bin.properties.district} ${bin.properties.address}` : `桶 #${c.bin_id}`}</div>
                    <div className="badges">
                      {c.status === "assigned" && c.team && <span className="badge">{c.team}</span>}
                      {Number(c.sensor_reports) > 0 && <span className="badge">感測器 ×{c.sensor_reports}</span>}
                      {Number(c.citizen_reports) > 0 && <span className="badge">民眾 ×{c.citizen_reports}</span>}
                      {c.kinds?.split(",").map((k) => <span key={k} className="badge kind">{KIND_LABEL[k as Kind]}</span>)}
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </main>
  );
}
