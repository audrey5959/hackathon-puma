import { useState } from "react";
import itrash from "../../../data/itrash.json";
import trucks from "../../../data/trucks.json";

// 預設不跳定位授權，先用示範區的西門里
const DEFAULT_PLACE = "萬華區 西門里";
// 最近的停靠點超過這個距離，視為不在臺北市
const FAR_M = 3000;
const WINDOW_MIN = 60;
const LIMIT = 10;
// iTrash 只有 18 站，先列最近的幾站，其餘收起來
const ITRASH_LIMIT = 3;
const ITRASH_NEAR_M = 2000;
const WEEKDAY = "日一二三四五六";

// 臺北市環保局：週三、週日不收；平面類週一、五，立體類週二、四、六
// https://www.gov.taipei/News_Content.aspx?n=F0DDAF49B89E9413&s=4774C3CD0F81D5DA&sms=72544237BBE4C5F6
const KINDS = {
  general: { label: "一般垃圾、廚餘", days: [1, 2, 4, 5, 6], hint: "", itrash: "trash" },
  flat: { label: "平面類回收", days: [1, 5], hint: "舊衣、廢紙、舊書、乾淨塑膠袋", itrash: null },
  solid: { label: "立體類回收", days: [2, 4, 6], hint: "瓶罐、紙容器、小家電、3C", itrash: "bottles" },
} as const;
type Kind = keyof typeof KINDS;

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const nowHHMM = () => new Date().toTimeString().slice(0, 5);
const days = (ds: readonly number[]) => "週" + ds.map((d) => WEEKDAY[d]).join("、");
const km = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const areaOf = (address: string) => address.match(/^(?:臺北市|新北市)(.+?區)/)?.[1] ?? "";
const mapsUrl = (destination: string) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=walking`;

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

function distM([lon1, lat1]: number[], [lon2, lat2]: number[]) {
  const x = (lon2 - lon1) * 111_320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const y = (lat2 - lat1) * 111_320;
  return Math.hypot(x, y);
}

export default function Trash() {
  const [time, setTime] = useState(nowHHMM);
  const [kind, setKind] = useState<Kind>("general");
  const [place, setPlace] = useState(DEFAULT_PLACE);
  const [mine, setMine] = useState<number[] | null>(null);
  const [locErr, setLocErr] = useState("");
  const here = mine ?? PLACES.get(place)!;
  const k = KINDS[kind];
  const [today] = useState(() => new Date().getDay());
  const collected = (k.days as readonly number[]).includes(today);
  const next = k.days.find((d) => d > today) ?? k.days[0];

  const from = toMin(time);
  const stops = trucks.features
    .filter((f) => {
      const t = toMin(f.properties.arrive);
      return t >= from && t <= from + WINDOW_MIN;
    })
    .map((f) => ({ ...f.properties, coords: f.geometry.coordinates, d: distM(here, f.geometry.coordinates) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, LIMIT);
  const far = Math.min(...trucks.features.map((f) => distM(here, f.geometry.coordinates))) > FAR_M;
  const machine = k.itrash;
  // 官網內嵌地圖缺座標的站排在最後
  const sites = (machine ? itrash.filter((s) => s[machine]) : [])
    .map((s) => ({ ...s, d: s.lon === null || s.lat === null ? null : distM(here, [s.lon, s.lat]) }))
    .sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity));
  const nearest = sites[0]?.d ?? null;

  function locate() {
    setLocErr("");
    if (!navigator.geolocation) return setLocErr("這個瀏覽器無法定位，請改選行政區與里。");
    navigator.geolocation.getCurrentPosition(
      (p) => setMine([p.coords.longitude, p.coords.latitude]),
      () => setLocErr("無法取得位置，請改選行政區與里。"),
      { timeout: 8000 },
    );
  }

  return (
    <main className="citizen">
      <h1>家用垃圾去哪丟</h1>
      <p className="muted">街上的行人清潔箱只收隨手垃圾。家用垃圾請交給垃圾車。</p>
      <div className="row">
        <select
          aria-label="行政區與里"
          value={mine ? "" : place}
          onChange={(e) => { setPlace(e.target.value); setMine(null); setLocErr(""); }}
        >
          {mine && <option value="">我的位置</option>}
          {[...PLACES.keys()].map((key) => <option key={key}>{key}</option>)}
        </select>
        <button onClick={locate}>使用我的位置</button>
      </div>
      {locErr && <p className="err">{locErr}</p>}
      {far && <p className="err">你的位置附近 3 km 內沒有臺北市的垃圾車停靠點，請改選行政區與里。</p>}
      <div className="chips" role="group" aria-label="垃圾種類">
        {(Object.keys(KINDS) as Kind[]).map((key) => (
          <button key={key} aria-pressed={key === kind} onClick={() => setKind(key)}>{KINDS[key].label}</button>
        ))}
      </div>
      <p>
        {k.hint && <span className="muted">{k.hint}。</span>}
        {k.label}在{days(k.days)}收。
        {collected ? `今天週${WEEKDAY[today]}有收。` : `今天週${WEEKDAY[today]}不收，下次是週${WEEKDAY[next]}。`}
      </p>
      {collected && !far && (
        <>
          <label className="row">
            幾點要丟
            <input type="time" value={time} onChange={(e) => setTime(e.target.value || nowHHMM())} />
          </label>
          <p className="muted">{mine ? "你的位置" : place}附近・{time} 起 {WINDOW_MIN} 分鐘內到站的垃圾車</p>
          {stops.length === 0 ? (
            <p>這段時間沒有垃圾車停靠。臺北市的垃圾車大多在 16:00 到 22:00 之間收運，換個時間看看。</p>
          ) : (
            <ol className="stops">
              {stops.map((s, i) => (
                <li key={i}>
                  <div className="row">
                    <strong>{s.arrive}</strong>
                    <span className="muted">{Math.round(s.d)} m</span>
                  </div>
                  <p>{s.address}</p>
                  <a href={mapsUrl(`${s.coords[1]},${s.coords[0]}`)} target="_blank" rel="noreferrer">開啟 Google 地圖導航</a>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      {sites.length > 0 && (
        <section className="itrash">
          <h2>錯過垃圾車：iTrash 自助站</h2>
          <p className="muted">
            以下是官網列出的{machine === "trash" ? "垃圾收集機" : "瓶罐收集機"}站點，
            來源：<a href="https://www.itrash.com.tw/pages/site" target="_blank" rel="noreferrer">iTrash 官網</a>。
          </p>
          {nearest !== null && nearest > ITRASH_NEAR_M && (
            <p>
              {mine ? "你的位置" : place}附近 {km(ITRASH_NEAR_M)} 內沒有 iTrash，最近的是{areaOf(sites[0].address)}的{sites[0].name}，約 {km(nearest)}。
            </p>
          )}
          <ItrashList sites={sites.slice(0, ITRASH_LIMIT)} />
          {sites.length > ITRASH_LIMIT && (
            <details>
              <summary>其他 {sites.length - ITRASH_LIMIT} 站</summary>
              <ItrashList sites={sites.slice(ITRASH_LIMIT)} />
            </details>
          )}
        </section>
      )}
      <p className="muted">垃圾車點位為臺北市開放資料。</p>
    </main>
  );
}

type Site = (typeof itrash)[number] & { d: number | null };

function ItrashList({ sites }: { sites: Site[] }) {
  return (
    <ol className="stops">
      {sites.map((s) => (
        <li key={s.name}>
          <div className="row">
            <strong>{s.name}</strong>
            {s.d !== null && <span className="muted">{km(s.d)}</span>}
          </div>
          <p>{s.address}</p>
          <a href={mapsUrl(s.lat === null ? s.address : `${s.lat},${s.lon}`)} target="_blank" rel="noreferrer">開啟 Google 地圖導航</a>
        </li>
      ))}
    </ol>
  );
}
