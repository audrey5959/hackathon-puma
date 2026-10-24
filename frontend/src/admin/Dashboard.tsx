import { BINS, binById, KIND_LABEL, usePoll, type Case, type Kind, type Status } from "../shared/api";

const DISTRICT_ORDER = ["中正區", "大同區", "中山區", "松山區", "大安區", "萬華區", "信義區", "士林區", "北投區", "內湖區", "南港區", "文山區"];
const LATE_MINUTES = 30; // 等待超過這個分鐘數，時間改成警示色
const SEVERE_MINUTES = 120; // 等待超過這個分鐘數，歸入最嚴重的一級
const LIST_HINT_OVER = 10; // 尚未完成超過這麼多筆，清單下方提示到待辦看全部

function utcMs(utc: string) {
  return new Date(`${utc.replace(" ", "T")}Z`).getTime();
}

function minutesSince(utc: string) {
  return Math.max(0, Math.floor((Date.now() - utcMs(utc)) / 60000));
}

function minutesBetween(from: string, to: string) {
  return Math.max(0, Math.round((utcMs(to) - utcMs(from)) / 60000));
}

function average(values: number[]) {
  return values.length ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length) : null;
}

function elapsed(minutes: number) {
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

function Composition({ segments }: { segments: { label: string; n: number; cls: string; display: string | number }[] }) {
  return (
    <>
      <span className="stack">
        {segments.map((s) => s.n > 0 && <i key={s.label} className={s.cls} style={{ flex: s.n }} />)}
      </span>
      <ul className="legend-list">
        {segments.map((s) => (
          <li key={s.label}>
            <i className={`swatch ${s.cls}`} />
            {s.label}
            <b>{s.display}</b>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function Dashboard() {
  const [cases] = usePoll<Case[]>("/api/cases");
  const list = cases ?? [];
  const open = tally(list, "open");
  const assigned = tally(list, "assigned");
  const done = tally(list, "done");
  const need = open + assigned;
  const pending = list
    .filter((c) => c.status !== "done")
    .sort((a, b) => Number(a.status !== "open") - Number(b.status !== "open") || a.opened_at.localeCompare(b.opened_at));
  const oldest = pending[0];
  const oldestMinutes = oldest ? minutesSince(oldest.opened_at) : 0;
  const ages = pending.map((c) => minutesSince(c.opened_at));
  const bands = [
    { cls: "b1", label: `${LATE_MINUTES} 分鐘內`, n: ages.filter((m) => m < LATE_MINUTES).length },
    { cls: "b2", label: `${LATE_MINUTES} 分–${SEVERE_MINUTES / 60} 小時`, n: ages.filter((m) => m >= LATE_MINUTES && m < SEVERE_MINUTES).length },
    { cls: "b3", label: `${SEVERE_MINUTES / 60} 小時以上`, n: ages.filter((m) => m >= SEVERE_MINUTES).length },
  ];
  const assignAvg = average(
    list.filter((c) => c.assigned_at).map((c) => minutesBetween(c.opened_at, c.assigned_at as string)),
  );
  const handleAvg = average(
    list.filter((c) => c.assigned_at && c.done_at).map((c) => minutesBetween(c.assigned_at as string, c.done_at as string)),
  );
  const rows = districts(list);
  const unfinishedRows = rows.filter((row) => row.open + row.assigned > 0);
  const idleRows = rows.filter((row) => row.open + row.assigned === 0);
  const top = unfinishedRows[0];
  const maxUnfinished = Math.max(1, ...unfinishedRows.map((row) => row.open + row.assigned));
  const shown = (n: number) => (cases ? n : "—");

  const headline = !cases
    ? "讀取案件中…"
    : need === 0
      ? "目前沒有需要處理的案件。"
      : `目前 ${need} 件需要處理${oldest ? `，最久的已等 ${elapsed(oldestMinutes)}` : ""}${top ? `；${top.name} 最多（${top.open + top.assigned} 件）` : ""}。`;

  const renderDistrict = (row: (typeof rows)[number]) => {
    const unfinished = row.open + row.assigned;
    return (
      <a key={row.name} className="district-row" href={`/?district=${encodeURIComponent(row.name)}`}>
        <b>{row.name}</b>
        <span className="bar-track" aria-hidden="true">
          <i style={{ width: `${(unfinished / maxUnfinished) * 100}%` }} />
        </span>
        <span className="district-meta">
          <b>{unfinished}</b> 件 · 已完成 {row.done}
        </span>
      </a>
    );
  };

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

      <p className={`headline${need > 0 && oldestMinutes >= LATE_MINUTES ? " late" : ""}`}>{headline}</p>

      <section className="overview" aria-label="案件總覽">
        <article className="need-block">
          <span>需要處理</span>
          <b>{shown(need)}</b>
          <span className="muted">待處理 {shown(open)} · 已指派 {shown(assigned)}</span>
        </article>

        <article className="overview-block">
          <h2>案件狀態</h2>
          <Composition
            segments={[
              { label: "待處理", n: open, cls: "open", display: shown(open) },
              { label: "已指派", n: assigned, cls: "assigned", display: shown(assigned) },
              { label: "已完成", n: done, cls: "done", display: shown(done) },
            ]}
          />
          {cases && (assignAvg !== null || handleAvg !== null) && (
            <p className="muted">
              全部案件平均：派工等待 {assignAvg ?? "—"} 分 · 處理 {handleAvg ?? "—"} 分
            </p>
          )}
        </article>

        <article className="overview-block">
          <h2>未完成等待時間</h2>
          <ul className="bands">
            {bands.map((band) => (
              <li key={band.cls} className={`band ${band.cls}`}>
                <b>{shown(band.n)}</b>
                <span>{band.label}</span>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <div className="board">
        <section className="card">
          <h2>各區未完成</h2>
          <p className="muted">依未完成件數排序，點一區回到待辦地圖。<a href="/bins">容易滿的桶</a>在桶一覽。</p>
          {cases && unfinishedRows.length === 0 && <p className="muted">目前各區都沒有未完成的案件。</p>}
          {cases && unfinishedRows.length > 0 && <div className="district-list">{unfinishedRows.map(renderDistrict)}</div>}
          {cases && idleRows.length > 0 && (
            <details className="idle-districts">
              <summary>其他 {idleRows.length} 區目前沒有未完成案件</summary>
              <div className="district-list">{idleRows.map(renderDistrict)}</div>
            </details>
          )}
        </section>

        <section className="card">
          <div className="row">
            <h2>尚未完成</h2>
            {oldest && (
              <span className={oldestMinutes >= LATE_MINUTES ? "muted wait late" : "muted"}>
                最久 {elapsed(oldestMinutes)}
              </span>
            )}
          </div>
          {cases && pending.length === 0 && (
            <p className="muted">目前沒有待清潔的案件。到<a href="/">待辦</a>按「模擬感測器」，或用市民回報頁建立案件。</p>
          )}
          <div className="cases-box">
            <ul className="cases">
              {pending.map((c) => {
                const bin = binById(c.bin_id);
                const district = bin?.properties.district ?? "";
                const waited = minutesSince(c.opened_at);
                return (
                  <li key={c.id} className={c.status}>
                    <a href={`/?district=${encodeURIComponent(district)}&bin=${c.bin_id}`}>
                      <b className="case-id">#{c.id} {c.status === "open" ? "待處理" : "已指派"}</b>
                      <span className="case-where">{bin ? `${bin.properties.district} ${bin.properties.address}` : `桶 #${c.bin_id}`}</span>
                      <span className="badges">
                        {c.status === "assigned" && c.team && <span className="badge">{c.team}</span>}
                        {Number(c.sensor_reports) > 0 && <span className="badge">感測器 ×{c.sensor_reports}</span>}
                        {Number(c.citizen_reports) > 0 && <span className="badge">民眾 ×{c.citizen_reports}</span>}
                        {c.kinds?.split(",").map((k) => <span key={k} className="badge kind">{KIND_LABEL[k as Kind]}</span>)}
                      </span>
                      <span className={waited >= LATE_MINUTES ? "muted wait late" : "muted wait"}>
                        {waited >= LATE_MINUTES && "⚠ "}等待 {elapsed(waited)}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
          {pending.length > LIST_HINT_OVER && (
            <p className="muted list-more">
              共 {pending.length} 筆未完成，<a href="/">到待辦看全部 →</a>
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
