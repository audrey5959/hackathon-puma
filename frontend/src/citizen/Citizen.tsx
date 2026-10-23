import { useState } from "react";
import { binById, KIND_LABEL, report, STATUS_LABEL, usePoll, type Case, type Kind, type Status } from "../shared/api";

const STEPS: Status[] = ["open", "assigned", "done"];

export default function Citizen({ binId }: { binId: number }) {
  const bin = binById(binId);
  const [caseId, setCaseId] = useState(() => new URLSearchParams(location.search).get("case"));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [c] = usePoll<Case>(caseId ? `/api/cases/${caseId}` : null);

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
    </main>
  );
}
