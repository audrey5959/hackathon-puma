import bins from "../../data/bins.json";

const SOURCES = ["sensor", "citizen"];
const KINDS = ["full", "dirty", "missing"];
const STATUSES = ["open", "assigned", "done"];
const BIN_COUNT = bins.features.length;

const CASE_SELECT = `
  SELECT c.*,
    SUM(r.source = 'sensor') AS sensor_reports,
    SUM(r.source = 'citizen') AS citizen_reports,
    GROUP_CONCAT(DISTINCT r.kind) AS kinds
  FROM cases c LEFT JOIN reports r ON r.case_id = c.id`;

const json = (body: unknown, status = 200) => Response.json(body, { status });
const error = (status: number, message: string) => json({ error: message }, status);

async function getCase(db: D1Database, id: number) {
  return db.prepare(`${CASE_SELECT} WHERE c.id = ? GROUP BY c.id`).bind(id).first();
}

async function createReport(req: Request, db: D1Database) {
  const body = (await req.json().catch(() => null)) as { bin_id?: unknown; source?: unknown; kind?: unknown } | null;
  const binId = Number(body?.bin_id);
  if (!Number.isInteger(binId) || binId < 1 || binId > BIN_COUNT) return error(400, "invalid bin_id");
  if (!SOURCES.includes(body?.source as string)) return error(400, "invalid source");
  if (!KINDS.includes(body?.kind as string)) return error(400, "invalid kind");

  const open = await db
    .prepare("SELECT id FROM cases WHERE bin_id = ? AND status IN ('open', 'assigned') ORDER BY id DESC LIMIT 1")
    .bind(binId)
    .first<{ id: number }>();
  const caseId =
    open?.id ??
    (await db.prepare("INSERT INTO cases (bin_id) VALUES (?) RETURNING id").bind(binId).first<{ id: number }>())!.id;
  await db.prepare("INSERT INTO reports (case_id, source, kind) VALUES (?, ?, ?)").bind(caseId, body!.source, body!.kind).run();
  return json(await getCase(db, caseId), open ? 200 : 201);
}

async function listCases(url: URL, db: D1Database) {
  const status = url.searchParams.get("status");
  if (status && !STATUSES.includes(status)) return error(400, "invalid status");
  const where = status ? "WHERE c.status = ?" : "";
  const stmt = db.prepare(`${CASE_SELECT} ${where} GROUP BY c.id ORDER BY c.id DESC`);
  const { results } = await (status ? stmt.bind(status) : stmt).all();
  return json(results);
}

async function updateCase(req: Request, db: D1Database, id: number) {
  const body = (await req.json().catch(() => null)) as { status?: unknown; team?: unknown } | null;
  const next = body?.status;
  if (next !== "assigned" && next !== "done") return error(400, "invalid status");
  const current = await db.prepare("SELECT status FROM cases WHERE id = ?").bind(id).first<{ status: string }>();
  if (!current) return error(404, "case not found");
  if (STATUSES.indexOf(next) <= STATUSES.indexOf(current.status)) return error(409, `cannot move ${current.status} to ${next}`);

  const team = typeof body?.team === "string" ? body.team : "清潔隊";
  const sql =
    next === "assigned"
      ? "UPDATE cases SET status = 'assigned', team = ?, assigned_at = datetime('now') WHERE id = ?"
      : "UPDATE cases SET status = 'done', team = COALESCE(team, ?), assigned_at = COALESCE(assigned_at, datetime('now')), done_at = datetime('now') WHERE id = ?";
  await db.prepare(sql).bind(team, id).run();
  return json(await getCase(db, id));
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const caseMatch = url.pathname.match(/^\/api\/cases\/(\d+)$/);

    if (url.pathname === "/api/reports" && req.method === "POST") return createReport(req, env.DB);
    if (url.pathname === "/api/cases" && req.method === "GET") return listCases(url, env.DB);
    if (caseMatch && req.method === "GET") {
      const found = await getCase(env.DB, Number(caseMatch[1]));
      return found ? json(found) : error(404, "case not found");
    }
    if (caseMatch && req.method === "PATCH") return updateCase(req, env.DB, Number(caseMatch[1]));
    return error(404, "not found");
  },
} satisfies ExportedHandler<Env>;
