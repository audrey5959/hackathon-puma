import { useCallback, useEffect, useRef, useState } from "react";
import { BINS, binById, HttpError, KIND_LABEL, report, STATUS_LABEL, usePoll, type Case, type Kind, type Status } from "../shared/api";

const STEPS: Status[] = ["open", "assigned", "done"];
const NEAR_M = 500;
// iOS Safari 分頁、部分舊瀏覽器沒有 Notification；這時只顯示進度條
const canNotify = typeof Notification !== "undefined";
const DIRS = ["北", "東北", "東", "東南", "南", "西南", "西", "西北"];

type Bin = (typeof BINS)[number];
interface Near { bin: Bin; m: number; dir: string }

// 市民看得懂的說明；原始錯誤由呼叫端 console.error 留給除錯
function reportErrorMessage(e: unknown): string {
  if (!(e instanceof HttpError)) return "網路不穩，請再按一次。";
  if (e.status >= 500) return "系統忙碌中，請稍後再試。";
  return "這個桶目前無法回報，請改用「地圖找桶」回報附近的桶。";
}

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

// 案件狀態只會往前走，完成後不會再變，停止輪詢不會漏掉更新
const isDone = (c: Case) => c.status === "done";

// 以 caseId 為 key 掛載：換案件時輪詢資料從頭來，不會沿用上一個案件的狀態
function Progress({ bin, caseId, onReset }: { bin: Bin; caseId: string; onReset: (notice?: string) => void }) {
  const [c, , cErr] = usePoll<Case>(`/api/cases/${encodeURIComponent(caseId)}`, 2000, isDone);
  const [notify, setNotify] = useState(false);
  const [perm, setPerm] = useState(() => (canNotify ? Notification.permission : "denied"));
  const notified = useRef(false);
  const gone = cErr instanceof HttpError && cErr.status === 404;
  const wrongBin = c !== null && c.bin_id !== bin.properties.id;
  // 附近桶位只在案件處理中顯示，完成或查無案件就不再拉列表
  const [cases] = usePoll<Case[]>(gone || wrongBin || c?.status === "done" ? null : "/api/cases");

  // 網址上的 case 是別的桶的：進度和地址會對不上，回到這個桶的回報畫面
  useEffect(() => {
    if (wrongBin) onReset(`案件 #${c.id} 不是這個桶的案件，請重新回報。`);
  }, [wrongBin, c, onReset]);

  useEffect(() => {
    if (!notify || c?.status !== "done" || notified.current) return;
    notified.current = true;
    const title = "垃圾桶處理完畢";
    const opts = { body: `案件 #${c.id}：${bin.properties.address}`, tag: `case-${c.id}`, data: { url: location.pathname + location.search } };
    // iOS 主畫面網頁 App、Android Chrome 只顯示從 Service Worker 發出的通知
    navigator.serviceWorker?.getRegistration()
      .then((reg) => {
        if (reg) return reg.showNotification(title, opts);
        new Notification(title, opts).onclick = () => window.focus();
      })
      .catch(() => {});
  }, [notify, c, bin]);

  async function askNotify() {
    navigator.serviceWorker?.register("/sw.js").catch(() => {});
    const p = await Notification.requestPermission().catch(() => "denied" as const);
    setPerm(p);
    setNotify(p === "granted");
  }

  if (gone) {
    return (
      <section className="progress">
        <p>找不到案件 #{caseId}。</p>
        <button onClick={() => onReset()}>回報這個桶</button>
      </section>
    );
  }
  // 斷線時 usePoll 會繼續重試，不當成查無案件
  if (!c || wrongBin) return <p className="muted">{cErr ? "連線不穩，重試中…" : "載入中…"}</p>;

  const done = c.status === "done";
  return (
    <>
      <section className="progress">
        <p>已收到回報，案件 #{c.id}</p>
        <ol>
          {STEPS.map((s) => (
            <li key={s} className={STEPS.indexOf(c.status) >= STEPS.indexOf(s) ? "on" : ""}>{STATUS_LABEL[s]}</li>
          ))}
        </ol>
        {c.team && <p className="muted">處理單位：{c.team}</p>}
        {cErr !== null && <p className="muted">連線不穩，進度可能不是最新的，重試中…</p>}
        {done ? (
          <>
            <p>這個桶處理好了，可以使用。</p>
            <button onClick={() => onReset()}>還有問題？再回報一次</button>
          </>
        ) : canNotify && (
          notify ? (
            <p className="muted">處理完畢時會通知你，請保持這個頁面開著（可以切到別的分頁）。</p>
          ) : perm === "denied" ? null : (
            <button onClick={askNotify}>處理完畢時通知我</button>
          )
        )}
      </section>
      {!done && <Nearby here={bin} mine={c} cases={cases} />}
    </>
  );
}

export default function Citizen({ binId }: { binId: number }) {
  const bin = binById(binId);
  const [caseId, setCaseId] = useState(() => new URLSearchParams(location.search).get("case"));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

  // 回到回報畫面，網址的 ?case= 一起拿掉，重新整理才不會又回到同一個案件
  const reset = useCallback((msg = "") => {
    history.replaceState(null, "", location.pathname);
    setCaseId(null);
    setNotice(msg);
  }, []);

  if (!bin) return <main className="citizen"><p>找不到這個垃圾桶（編號 {binId}）。</p></main>;

  async function send(kind: Kind) {
    setBusy(true);
    setErr("");
    setNotice("");
    try {
      const created = await report(binId, "citizen", kind);
      history.replaceState(null, "", `?case=${created.id}`);
      setCaseId(String(created.id));
    } catch (e) {
      console.error(e);
      setErr(reportErrorMessage(e));
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
          {notice && <p className="err">{notice}</p>}
          <p>這個桶怎麼了？</p>
          <div className="kinds">
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <button key={k} disabled={busy} onClick={() => send(k)}>{KIND_LABEL[k]}</button>
            ))}
          </div>
          {err && <p className="err">{err}</p>}
        </>
      ) : (
        <Progress key={caseId} bin={bin} caseId={caseId} onReset={reset} />
      )}
    </main>
  );
}
