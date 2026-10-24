import { useMemo, useState } from "react";
import { BINS } from "../shared/api";
import { DistrictSelect } from "./DistrictSelect";
import { plannedUsage, type UsageBand } from "./weekCapacity";

const DISTRICT_ORDER = ["中正區", "大同區", "中山區", "松山區", "大安區", "萬華區", "信義區", "士林區", "北投區", "內湖區", "南港區", "文山區"];
const DEMO_FIRST = ["萬華區", "中正區"];

type Filter = UsageBand | "all";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "high", label: "容易滿" },
  { id: "mid", label: "普通" },
  { id: "low", label: "少用" },
  { id: "all", label: "全部" },
];

const rank = (name: string) => {
  const demo = DEMO_FIRST.indexOf(name);
  if (demo !== -1) return demo - DEMO_FIRST.length;
  const index = DISTRICT_ORDER.indexOf(name);
  return index === -1 ? DISTRICT_ORDER.length : index;
};

export default function Bins() {
  const [district, setDistrict] = useState("");
  const [filter, setFilter] = useState<Filter>("high");
  const districts = useMemo(() => {
    const names = [...new Set(BINS.map((bin) => bin.properties.district))].sort((a, b) => rank(a) - rank(b));
    return names;
  }, []);

  const groups = useMemo(() => {
    const rows = new Map<string, { name: string; total: number; bins: { id: number; address: string; times: number; detail: string; band: UsageBand }[] }>();
    for (const bin of BINS) {
      const name = bin.properties.district;
      const row = rows.get(name) ?? { name, total: 0, bins: [] };
      row.total += 1;
      const usage = plannedUsage(bin.properties.id);
      if ((district === "" || name === district) && (filter === "all" || usage.band === filter)) {
        row.bins.push({ id: bin.properties.id, address: bin.properties.address, times: usage.times, detail: usage.detail, band: usage.band });
      }
      rows.set(name, row);
    }
    return [...rows.values()]
      .filter((row) => row.bins.length > 0)
      .sort((a, b) => rank(a.name) - rank(b.name))
      .map((row) => ({
        ...row,
        bins: row.bins.sort((a, b) => b.times - a.times || a.id - b.id),
      }));
  }, [district, filter]);

  return (
    <main className="dashboard">
      <div className="dash-head">
        <div>
          <h1>桶一覽</h1>
          <p className="muted">使用強度依桶編號模擬，不是感測器紀錄。一週升過 80% 至少 3 次算容易滿。</p>
        </div>
      </div>

      <div className="bins-tools">
        <DistrictSelect value={district} options={districts} onChange={setDistrict} />
        <div className="chips" role="group" aria-label="使用強度">
          {FILTERS.map((item) => (
            <button key={item.id} type="button" className={filter === item.id ? "on" : ""} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 && <p className="muted">這個篩選沒有桶。</p>}

      <div className="bin-groups">
        {groups.map((group) => (
          <section key={group.name} className="card">
            <h2>{group.name}<span className="muted"> {group.bins.length} / {group.total} 座</span></h2>
            <ul className="bin-rows">
              {group.bins.map((bin) => (
                <li key={bin.id}>
                  <a href={`/?district=${encodeURIComponent(group.name)}&bin=${bin.id}`}>
                    <b>#{bin.id}</b>
                    <span>{bin.address}</span>
                    <span className={`intensity ${bin.band}`}>{bin.detail}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
