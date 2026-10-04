CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  receipt_hash TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  annotation TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('uploading','pending','approved','rejected','expired')),
  created_at INTEGER NOT NULL,
  upload_expires INTEGER NOT NULL,
  submitted_at INTEGER,
  reviewed_at INTEGER,
  photo_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  object_etag TEXT,
  released INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS submissions_status_time ON submissions(status, created_at);
CREATE TABLE IF NOT EXISTS submission_budget (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  reserved_bytes INTEGER NOT NULL DEFAULT 0,
  day TEXT NOT NULL DEFAULT '',
  daily_count INTEGER NOT NULL DEFAULT 0,
  daily_bytes INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO submission_budget(id) VALUES(1);
