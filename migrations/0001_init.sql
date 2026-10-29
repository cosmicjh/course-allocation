CREATE TABLE workspace (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL CHECK (json_valid(payload) AND length(CAST(payload AS BLOB)) <= 1500000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
);
CREATE TABLE sheets (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL CHECK (json_valid(payload) AND length(CAST(payload AS BLOB)) <= 1500000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  identity_hash TEXT NOT NULL DEFAULT '',
  last_operation TEXT,
  request_hash TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE operations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  sheet_id TEXT,
  request_hash TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX operations_expiry ON operations(created_at);
-- JSON preserves the legacy format; this small index also enforces IDs across sheets.
CREATE TABLE entity_ids (
  kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  sheet_id TEXT NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  PRIMARY KEY(kind,entity_id)
);
CREATE INDEX entity_sheet ON entity_ids(sheet_id);
CREATE VIEW sheet_entities AS
  SELECT s.id AS sheet_id,'teacher' AS kind,json_extract(e.value,'$.id') AS entity_id FROM sheets s,json_each(s.payload,'$.teachers') e
  UNION ALL SELECT s.id,'course',json_extract(e.value,'$.id') FROM sheets s,json_each(s.payload,'$.courses') e
  UNION ALL SELECT s.id,'group',json_extract(e.value,'$.id') FROM sheets s,json_each(s.payload,'$.groups') e
  UNION ALL SELECT s.id,'unmapped',json_extract(e.value,'$.id') FROM sheets s,json_each(s.payload,'$.unmapped') e
  UNION ALL SELECT s.id,'section',json_extract(slot.value,'$.id') FROM sheets s,json_each(s.payload,'$.groups') grp,json_each(grp.value,'$.slots') slot;
CREATE TRIGGER index_sheet_insert AFTER INSERT ON sheets
BEGIN
  INSERT INTO entity_ids(kind,entity_id,sheet_id) SELECT kind,entity_id,sheet_id FROM sheet_entities WHERE sheet_id=NEW.id;
END;
CREATE TRIGGER index_sheet_update AFTER UPDATE OF payload ON sheets WHEN NEW.identity_hash != OLD.identity_hash
BEGIN
  DELETE FROM entity_ids WHERE sheet_id=NEW.id AND NOT EXISTS (
    SELECT 1 FROM sheet_entities e WHERE e.sheet_id=NEW.id AND e.kind=entity_ids.kind AND e.entity_id=entity_ids.entity_id
  );
  INSERT INTO entity_ids(kind,entity_id,sheet_id)
    SELECT kind,entity_id,sheet_id FROM sheet_entities WHERE sheet_id=NEW.id
    EXCEPT SELECT kind,entity_id,sheet_id FROM entity_ids WHERE sheet_id=NEW.id;
END;
CREATE TRIGGER sheet_operation AFTER UPDATE ON sheets WHEN NEW.last_operation IS NOT NULL
BEGIN
  INSERT INTO operations(id, kind, sheet_id, request_hash, result, created_at)
  VALUES (NEW.last_operation, 'sheet', NEW.id, NEW.request_hash,
          json_object('revision', NEW.revision), NEW.updated_at);
END;
CREATE TABLE credentials (
  kind TEXT PRIMARY KEY CHECK (kind IN ('access','admin')),
  password_hash TEXT NOT NULL,
  epoch INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('input','admin')),
  access_epoch INTEGER NOT NULL,
  admin_epoch INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE login_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX login_limits_expiry ON login_limits(expires_at);
-- A failed version comparison must abort the entire batch, not just update zero rows.
CREATE TABLE write_guards (
  id TEXT PRIMARY KEY,
  global_revision INTEGER,
  sheet_revisions TEXT,
  access_epoch INTEGER,
  admin_epoch INTEGER
);
CREATE TRIGGER check_write_guard BEFORE INSERT ON write_guards
BEGIN
  SELECT CASE WHEN NEW.global_revision IS NOT NULL AND NEW.global_revision !=
    COALESCE((SELECT revision FROM workspace WHERE id=1),-1)
    THEN RAISE(ABORT,'global_conflict') END;
  SELECT CASE WHEN NEW.sheet_revisions IS NOT NULL AND EXISTS (
    SELECT 1 FROM json_each(NEW.sheet_revisions) expected LEFT JOIN sheets current ON current.id=expected.key
    WHERE current.revision IS NULL OR current.revision != expected.value
  ) THEN RAISE(ABORT,'sheet_conflict') END;
  SELECT CASE WHEN NEW.access_epoch IS NOT NULL AND NEW.access_epoch !=
    COALESCE((SELECT epoch FROM credentials WHERE kind='access'),-1)
    THEN RAISE(ABORT,'auth_conflict') END;
  SELECT CASE WHEN NEW.admin_epoch IS NOT NULL AND NEW.admin_epoch !=
    COALESCE((SELECT epoch FROM credentials WHERE kind='admin'),-1)
    THEN RAISE(ABORT,'auth_conflict') END;
END;
INSERT INTO workspace(id,payload) VALUES (1,'{"schemaVersion":1,"uiVersion":3,"school":{"name":"새 학교","year":2026,"semester":1,"grades":[{"grade":1,"classCount":0,"movingCount":0},{"grade":2,"classCount":0,"movingCount":0},{"grade":3,"classCount":0,"movingCount":0}]},"source":{},"customCatalog":[],"departmentIds":["d1"]}');
INSERT INTO sheets(id,payload) VALUES ('d1','{"department":{"id":"d1","name":"새 교과군","status":"draft","sourceTotal":null,"note":""},"teachers":[],"courses":[],"groups":[],"assignments":[],"unmapped":[]}');
