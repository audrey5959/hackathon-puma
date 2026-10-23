import Admin from "./admin/Admin";
import Citizen from "./citizen/Citizen";

export default function App() {
  const bin = location.pathname.match(/^\/b\/(\d+)$/);
  return (
    <>
      <header className="bar">
        <a href="/" className="brand">桶緝犯</a>
        <span className="tag">模擬資料：回報、案件與感測器數值皆為測試資料；桶位為臺北市開放資料</span>
      </header>
      {bin ? <Citizen binId={Number(bin[1])} /> : <Admin />}
    </>
  );
}
