import { lazy, Suspense, useEffect, useState } from "react";
import itrash from "../../../data/itrash.json";
import trucks from "../../../data/trucks.json";
import Combobox from "./Combobox";

// 小地圖另拆。Trash 本身不引用 MapLibre，按了「在地圖上看」才下載
const StopMap = lazy(() => import("./StopMap"));

// 預設不跳定位授權，先用示範區的西門里
const DEFAULT_PLACE = "萬華區 西門里";
const STORE_KEY = "trash.place";
// 最近的停靠點超過這個距離，視為不在臺北市
const FAR_M = 3000;
// 先取這個範圍內的停靠點，再照到站時間排；範圍內一個都沒有時改取最近的幾個
const NEAR_M = 500;
const LIMIT = 5;
const WEEKDAY = "日一二三四五六";
// 「改時間」的選項；臺北市的垃圾車大多在 16:00 到 22:00 之間收運
const HOURS = ["16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00"];

// 臺北市環保局：週三、週日不收；平面類週一、五，立體類週二、四、六
// https://www.gov.taipei/News_Content.aspx?n=F0DDAF49B89E9413&s=4774C3CD0F81D5DA&sms=72544237BBE4C5F6
const KINDS = {
  general: { label: "一般垃圾、廚餘", days: [1, 2, 4, 5, 6], hint: "", itrash: "trash" },
  flat: { label: "平面類回收", days: [1, 5], hint: "舊衣、廢紙、舊書、乾淨塑膠袋", itrash: null },
  solid: { label: "立體類回收", days: [2, 4, 6], hint: "瓶罐、紙容器、小家電、3C", itrash: "bottles" },
} as const;
type Kind = keyof typeof KINDS;

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const nowMin = () => new Date().getHours() * 60 + new Date().getMinutes();
const mapsUrl = (destination: string) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=walking`;
// 同一頁都在臺北市，卡片上省略市名和行政區
const shortAddr = (address: string) => address.replace(/^臺北市\S{1,3}?區/, "");
// iTrash 有新北市的站，新北市的站連市名一起標
const areaOf = (address: string) => {
  const m = address.match(/^(臺北市|新北市)\s*(\S{1,3}?區)/);
  return !m ? "" : m[1] === "臺北市" ? m[2] : m[1] + m[2];
};
// 和 /b 附近桶的算法一樣：直線距離乘 1.3 估算繞路，步行每分鐘 80 m
const walk = (m: number) => (m * 1.3 < 80 ? "步行 1 分鐘內" : `步行約 ${Math.round((m * 1.3) / 80)} 分鐘`);
const km = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const wait = (min: number) => (min < 60 ? `還有 ${min} 分` : `還有 ${Math.floor(min / 60)} 小時 ${min % 60} 分`);

// 以「行政區 里」的停靠點平均位置當作選位置，不需要地址轉座標服務
const PLACES = (() => {
  const acc = new Map<string, number[]>();
  for (const f of trucks.features) {
    const key = `${f.properties.district} ${f.properties.village}`;
    const [lon, lat] = f.geometry.coordinates;
    const a = acc.get(key) ?? [0, 0, 0];
    acc.set(key, [a[0] + lon, a[1] + lat, a[2] + 1]);
  }
  return new Map([...acc].sort(([a], [b]) => a.localeCompare(b, "zh-TW")).map(([key, [lon, lat, n]]) => [key, [lon / n, lat / n]]));
})();
const VILLAGES = new Map<string, string[]>();
for (const key of PLACES.keys()) {
  const [district, village] = key.split(" ");
  VILLAGES.set(district, [...(VILLAGES.get(district) ?? []), village]);
}

// 搜尋時忽略「臺／台」和「區」「里」；空白分開的每個詞都要比對得到，例如「萬華 西門」
const norm = (s: string) => s.replace(/臺/g, "台").replace(/[區里\s]/g, "");
const matcher = (query: string) => {
  const words = query.split(/\s+/).map(norm).filter(Boolean);
  return (key: string) => words.every((w) => norm(key).includes(w));
};
const districtOptions = (query: string) =>
  [...VILLAGES.keys()].filter(matcher(query)).map((d) => ({ key: d, label: d }));
// 沒打字時列目前這一區的里；打字時也找其他區，目前這一區的排前面
const villageOptions = (district: string) => (query: string) => {
  const own = VILLAGES.get(district)!.map((v) => ({ key: `${district} ${v}`, label: v }));
  if (!query.trim()) return own;
  const hit = matcher(query);
  const others = [...PLACES.keys()].filter((key) => !key.startsWith(`${district} `)).map((key) => ({ key, label: key }));
  return [...own, ...others].filter((o) => hit(o.key));
};

const STOPS = trucks.features.map((f) => ({ ...f.properties, coords: f.geometry.coordinates }));
type Stop = (typeof STOPS)[number] & { d: number };

function distM([lon1, lat1]: number[], [lon2, lat2]: number[]) {
  const x = (lon2 - lon1) * 111_320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const y = (lat2 - lat1) * 111_320;
  return Math.hypot(x, y);
}

// localStorage 在私密瀏覽、封鎖網站資料時可能丟例外
function loadPlace() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved && PLACES.has(saved)) return saved;
  } catch { /* 用預設值 */ }
  return DEFAULT_PLACE;
}
function savePlace(place: string) {
  try { localStorage.setItem(STORE_KEY, place); } catch { /* 下次重選 */ }
}

export default function Trash() {
  const [kind, setKind] = useState<Kind>("general");
  const [place, setPlace] = useState(loadPlace);
  const [mine, setMine] = useState<number[] | null>(null);
  const [locating, setLocating] = useState(false);
  const [locErr, setLocErr] = useState("");
  // 空字串代表「現在」，每 30 秒更新一次倒數
  const [time, setTime] = useState("");
  const [now, setNow] = useState(nowMin);
  const [today] = useState(() => new Date().getDay());
  const [mapOn, setMapOn] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(nowMin()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const here = mine ?? PLACES.get(place)!;
  const [district, village] = place.split(" ");
  const k = KINDS[kind];
  const collectDays = k.days as readonly number[];
  const from = time ? toMin(time) : now;

  const byDist = STOPS.map((s): Stop => ({ ...s, d: distM(here, s.coords) })).sort((a, b) => a.d - b.d);
  const far = byDist[0].d > FAR_M;
  const within = byDist.filter((s) => s.d <= NEAR_M);
  const wide = within.length === 0;
  const near = wide ? byDist.slice(0, 20) : within;
  // 路線和時間在每個收運日都一樣：今天收而且還有車會來就列今天的，否則列下一個收運日一整天的
  const later = collectDays.includes(today) ? near.filter((s) => toMin(s.leave) >= from) : [];
  const onToday = later.length > 0;
  const day = onToday ? today : (collectDays.find((d) => d > today) ?? collectDays[0]);
  const list = (onToday ? later : near).sort((a, b) => a.arrive.localeCompare(b.arrive)).slice(0, LIMIT);
  const first = list[0];
  // 同一條路線是同一台車：第一班錯過了，告訴使用者這台車接下來、清單上沒有的那一站
  const listed = new Set(list.map((s) => `${s.route} ${s.arrive}`));
  const after = first && STOPS.filter((s) => s.route === first.route && s.arrive > first.leave && !listed.has(`${s.route} ${s.arrive}`))
    .sort((a, b) => a.arrive.localeCompare(b.arrive))[0];

  const machine = k.itrash;
  // 依距離排序；官網內嵌地圖缺座標的站排在最後
  const sites = (machine ? itrash.filter((s) => s[machine]) : [])
    .map((s) => ({ ...s, area: areaOf(s.address), d: s.lon === null || s.lat === null ? null : distM(here, [s.lon, s.lat]) }))
    .sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity));
  const nearest = sites[0];

  function choose(next: string) {
    setPlace(next);
    savePlace(next);
    setMine(null);
    setLocErr("");
  }

  function locate() {
    setLocErr("");
    if (!navigator.geolocation) return setLocErr("這個瀏覽器無法定位，請改選行政區與里。");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setMine([p.coords.longitude, p.coords.latitude]);
      },
      (err) => {
        setLocating(false);
        setLocErr(err.code === err.PERMISSION_DENIED ? "沒有定位權限，請改選行政區與里。" : "暫時無法定位，請改選行政區與里。");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  let heading = "附近接下來的垃圾車";
  if (!onToday) {
    const why = collectDays.includes(today) ? `今天${time ? ` ${time} 之後` : ""}的車都過了` : `今天週${WEEKDAY[today]}不收`;
    heading = `${why}，下次週${WEEKDAY[day]}收運`;
  } else if (time) heading = `附近 ${time} 之後的垃圾車`;
  const when = (s: Stop) => `${onToday ? "" : `週${WEEKDAY[day]} `}${s.arrive}–${s.leave}`;

  return (
    <main className="citizen">
      <h1>家用垃圾去哪丟</h1>
      <p className="muted">街上的行人清潔箱只收隨手垃圾。家用垃圾請交給垃圾車。</p>
      <div className="place">
        <Combobox
          label="行政區"
          value={mine ? "我的位置" : district}
          options={districtOptions}
          empty="找不到符合的行政區"
          onSelect={(d) => choose(`${d} ${VILLAGES.get(d)![0]}`)}
        />
        <Combobox
          label="里"
          value={mine ? "—" : village}
          options={villageOptions(district)}
          empty="找不到符合的里"
          onSelect={choose}
        />
        <button disabled={locating} onClick={locate}>{locating ? "定位中…" : "我的位置"}</button>
      </div>
      {locErr && <p className="err" role="status">{locErr}</p>}
      {far && <p className="err">你的位置附近 3 km 內沒有臺北市的垃圾車停靠點，請改選行政區與里。</p>}
      <div className="chips" role="group" aria-label="垃圾種類">
        {(Object.keys(KINDS) as Kind[]).map((key) => (
          <button key={key} className={key === kind ? "on" : ""} aria-pressed={key === kind} onClick={() => setKind(key)}>{KINDS[key].label}</button>
        ))}
      </div>
      <div className="week-row">
        <span className="muted">收運日</span>
        <ol className="week" aria-label={`${k.label}的收運日`}>
          {[...WEEKDAY].map((c, d) => {
            const on = collectDays.includes(d);
            return (
              <li key={d} className={`${on ? "on" : ""}${d === today ? " today" : ""}`} aria-label={`週${c}${on ? "收" : "不收"}${d === today ? "（今天）" : ""}`}>
                {c}
              </li>
            );
          })}
        </ol>
      </div>
      {k.hint && <p className="muted">{k.hint}</p>}

      {!far && (
        <section className="nearby">
          <h2>{heading}</h2>
          {wide && <p className="muted">{NEAR_M} m 內沒有停靠點，以下是較遠的。</p>}
          {list.length > 0 && (
            <button className="map-toggle" aria-expanded={mapOn} aria-controls="stop-map" onClick={() => setMapOn((open) => !open)}>
              {mapOn ? "收起地圖" : "在地圖上看"}
            </button>
          )}
          {mapOn && list.length > 0 && (
            <Suspense fallback={<p className="muted">載入地圖中…</p>}>
              <StopMap here={here} hereLabel={mine ? "你的位置" : place} stops={list} />
            </Suspense>
          )}
          <ol>
            {list.map((s, i) => (
              <li key={`${s.route}-${s.arrive}-${s.address}`} className={i === 0 ? "first" : ""}>
                <a href={mapsUrl(`${s.coords[1]},${s.coords[0]}`)} target="_blank" rel="noopener noreferrer">
                  <span className="row">
                    <span>{i === 0 && <span className="tag">下一班</span>} <b>{when(s)}</b></span>
                    {i === 0 && onToday && !time && (
                      <span className="muted">{toMin(s.arrive) <= now ? `車在這站，停到 ${s.leave}` : wait(toMin(s.arrive) - now)}</span>
                    )}
                  </span>
                  <b>{shortAddr(s.address)}</b>
                  <span className="row muted">
                    <span>{Math.round(s.d)} m・{walk(s.d)}</span>
                    <span aria-hidden="true">導航 ›</span>
                  </span>
                </a>
              </li>
            ))}
          </ol>
          {after && (
            <p className="muted">
              錯過了？同一台車（{first.route}）{after.arrive} 會到{" "}
              <a href={mapsUrl(`${after.coords[1]},${after.coords[0]}`)} target="_blank" rel="noopener noreferrer">
                {shortAddr(after.address)}
              </a>
              （{Math.round(distM(here, after.coords))}&nbsp;m）。
            </p>
          )}
          <label className="when muted">
            改時間
            <select value={time} onChange={(e) => setTime(e.target.value)}>
              <option value="">現在</option>
              {HOURS.map((h) => <option key={h} value={h}>{h} 之後</option>)}
            </select>
          </label>
        </section>
      )}

      {sites.length > 0 && (
        <details className="nearby itrash">
          <summary>iTrash 自助站（{sites.length} 站{nearest.d !== null && `，最近 ${km(nearest.d)}`}）</summary>
          <p className="muted">
            錯過垃圾車時可以丟這裡。以下是官網列出的{machine === "trash" ? "垃圾收集機" : "瓶罐收集機"}站點，來源：<a href="https://www.itrash.com.tw/pages/site" target="_blank" rel="noreferrer">iTrash 官網</a>。
          </p>
          <ol>
            {sites.map((s) => (
              <li key={s.name}>
                <a href={mapsUrl(s.lat === null ? s.address : `${s.lat},${s.lon}`)} target="_blank" rel="noopener noreferrer">
                  {s.area && <span className="tag">{s.area}</span>}
                  <span className="row">
                    <b>{s.name}</b>
                    {s.d !== null && <span className="muted">{km(s.d)}</span>}
                  </span>
                  <span className="row muted">
                    <span>{s.address}</span>
                    <span aria-hidden="true">導航 ›</span>
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </details>
      )}
      <p className="muted">垃圾車點位為臺北市開放資料。</p>
    </main>
  );
}
