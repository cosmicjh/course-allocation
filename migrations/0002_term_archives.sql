CREATE TABLE term_archives(
  term TEXT NOT NULL,
  sheet_id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  identity_hash TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(term,sheet_id)
);
