import { useState } from "react";
import { BINS, binById, KIND_LABEL, report, STATUS_LABEL, usePoll, type Case, type Kind, type Status } from "../shared/api";

const STEPS: Status[] = ["open", "assigned", "done"];
const NEAR_M = 500;
const DIRS = ["北", "東北", "東", "東南", "南", "西南", "西", "西北"];

type Bin = (typeof BINS)[number];
interface Near { bin: Bin; m: number; dir: string }

// 桶與桶之間只有幾百公尺，用平面近似就夠準
function measure(from: Bin, to: Bin): { m: number; dir: string } {
  const [x0, y0] = from.geometry.coordinates;
  const [x1, y1] = to.geometry.coordinates;
  const dx = (x1 - x0) * 111320 * Math.cos((y0 * Math.PI) / 180);
  const dy = (y1 - y0) * 110540;
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return { m: Math.hypot(dx, dy), dir: DIRS[Math.round(((deg + 360) % 360) / 45) % 8] };
}

// 直線距離乘 1.3 估算繞路，步行每分鐘 80 m
const walk = (m: number) => (m * 1.3 < 80 ? "步行 1 分鐘內" : `步行約 ${Math.round((m * 1.3) / 80)} 分鐘`);

// 未完成的「滿了」「沒有桶」案件的桶不能丟；「髒亂」照樣列出
function nearby(here: Bin, cases: Case[]) {
  const blocked = new Set(
    cases.filter((c) => c.status !== "done" && /full|missing/.test(c.kinds ?? "")).map((c) => c.bin_id),
  );
  const all = BINS.filter((b) => b.properties.id !== here.properties.id)
    .map((bin): Near => ({ bin, ...measure(here, bin) }))
    .sort((a, b) => a.m - b.m);
  const list: Near[] = [];
  let skipped = 0;
  for (const n of all) {
    if (list.length === 3) break;
    if (blocked.has(n.bin.properties.id)) skipped++;
    else list.push(n);
  }
  return { list, skipped, allFull: list.length > 0 && list[0].m > NEAR_M };
}

function Nearby({ here, mine, cases }: { here: Bin; mine: Case | null; cases: Case[] | null }) {
  if (!cases || !mine) return null;
  const { list, skipped, allFull } = nearby(here, cases);
  const dirtyOnly = mine.kinds === "dirty";
  return (
    <section className="nearby">
      <h2>{dirtyOnly ? "也可以去附近的桶" : "附近可以丟的桶"}</h2>
      {allFull && <p className="muted">附近 {NEAR_M} m 內的桶都回報滿了，清潔隊處理中；以下是較遠的桶。</p>}
      {!allFull && skipped > 0 && <p className="muted">附近有 {skipped} 個桶也回報滿了，清潔隊處理中。</p>}
      <ol>
        {list.map((n, i) => {
          const [lng, lat] = n.bin.geometry.coordinates;
          return (
            <li key={n.bin.properties.id} className={i === 0 ? "first" : ""}>
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`} target="_blank" rel="noopener noreferrer">
                {i === 0 && <span className="tag">最近</span>}
                <b>{n.bin.properties.address}</b>
                <span className="muted">往{n.dir} {Math.round(n.m)} m・{walk(n.m)}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default function Citizen({ binId }: { binId: number }) {
  const bin = binById(binId);
  const [caseId, setCaseId] = useState(() => new URLSearchParams(location.search).get("case"));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [c] = usePoll<Case>(caseId ? `/api/cases/${caseId}` : null);
  const [cases] = usePoll<Case[]>(caseId ? "/api/cases" : null);

  if (!bin) return <main className="citizen"><p>找不到這個垃圾桶（編號 {binId}）。</p></main>;

  async function send(kind: Kind) {
    setBusy(true);
    setErr("");
    try {
      const created = await report(binId, "citizen", kind);
      history.replaceState(null, "", `?case=${created.id}`);
      setCaseId(String(created.id));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="citizen">
      <p className="muted">{bin.properties.district}・桶 #{binId}</p>
      <h1>{bin.properties.address}</h1>
      {!caseId ? (
        <>
          <p>這個桶怎麼了？</p>
          <div className="kinds">
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <button key={k} disabled={busy} onClick={() => send(k)}>{KIND_LABEL[k]}</button>
            ))}
          </div>
          {err && <p className="err">回報失敗：{err}</p>}
        </>
      ) : (
        <section className="progress">
          <p>已收到回報，案件 #{caseId}</p>
          <ol>
            {STEPS.map((s) => (
              <li key={s} className={c && STEPS.indexOf(c.status) >= STEPS.indexOf(s) ? "on" : ""}>{STATUS_LABEL[s]}</li>
            ))}
          </ol>
          {c?.team && <p className="muted">處理單位：{c.team}</p>}
        </section>
      )}
      {caseId && <Nearby here={bin} mine={c} cases={cases} />}
    </main>
  );
}
