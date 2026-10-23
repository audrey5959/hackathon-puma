CREATE TABLE cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bin_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'done')),
  team TEXT,
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  assigned_at TEXT,
  done_at TEXT
);

CREATE INDEX cases_bin_status ON cases (bin_id, status);

CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES cases (id),
  source TEXT NOT NULL CHECK (source IN ('sensor', 'citizen')),
  kind TEXT NOT NULL CHECK (kind IN ('full', 'dirty', 'missing')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX reports_case ON reports (case_id);
