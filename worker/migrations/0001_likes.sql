CREATE TABLE IF NOT EXISTS photo_likes (
  photo_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (photo_id, visitor_id)
) WITHOUT ROWID;
