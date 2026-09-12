import type Database from "better-sqlite3";

interface Migration { version: number; name: string; sql: string }

const migrations: Migration[] = [{
  version: 1,
  name: "foundation",
  sql: `
    CREATE TABLE courses (
      id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL,
      icon TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE weeks (
      id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      name TEXT NOT NULL, position INTEGER NOT NULL CHECK(position > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(course_id, position)
    );
    CREATE TABLE week_files (
      id TEXT PRIMARY KEY, week_id TEXT NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('pdf','translation','transcript_txt','transcript_json')),
      original_name TEXT NOT NULL, managed_path TEXT NOT NULL, sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(week_id, kind)
    );
    CREATE TABLE reading_progress (
      week_id TEXT PRIMARY KEY REFERENCES weeks(id) ON DELETE CASCADE, page_number INTEGER NOT NULL DEFAULT 1,
      zoom REAL NOT NULL DEFAULT 1, layout TEXT NOT NULL DEFAULT 'bilingual', panel_sizes_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL
    );
    CREATE TABLE annotations (
      id TEXT PRIMARY KEY, week_id TEXT NOT NULL REFERENCES weeks(id) ON DELETE CASCADE, page_number INTEGER NOT NULL,
      type TEXT NOT NULL, payload_json TEXT NOT NULL, color TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE notes (
      id TEXT PRIMARY KEY, course_id TEXT REFERENCES courses(id) ON DELETE CASCADE, week_id TEXT REFERENCES weeks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, content TEXT NOT NULL, pdf_page INTEGER, transcript_start_ms INTEGER, annotation_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE transcript_segments (
      id TEXT PRIMARY KEY, week_id TEXT NOT NULL REFERENCES weeks(id) ON DELETE CASCADE, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
      raw_text TEXT NOT NULL, corrected_text TEXT, words_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE page_transcript_alignments (
      id TEXT PRIMARY KEY, week_id TEXT NOT NULL REFERENCES weeks(id) ON DELETE CASCADE, page_number INTEGER NOT NULL,
      transcript_start_ms INTEGER NOT NULL, transcript_end_ms INTEGER NOT NULL, confidence REAL NOT NULL,
      method TEXT NOT NULL CHECK(method IN ('automatic','manual')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE ai_insights (
      id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE, week_id TEXT NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      type TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, importance INTEGER NOT NULL, confidence REAL NOT NULL,
      page_numbers_json TEXT NOT NULL, transcript_start_ms INTEGER, transcript_end_ms INTEGER, evidence_json TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK(source_type IN ('explicit','ai_inference')), created_at TEXT NOT NULL
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX idx_weeks_course ON weeks(course_id, position);
    CREATE INDEX idx_week_files_week ON week_files(week_id);
    CREATE INDEX idx_segments_week_time ON transcript_segments(week_id, start_ms);
  `,
}, {
  version: 2,
  name: "reader_progress",
  sql: `
    ALTER TABLE reading_progress ADD COLUMN fit_mode TEXT NOT NULL DEFAULT 'width';
    ALTER TABLE reading_progress ADD COLUMN translation_sync INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE reading_progress ADD COLUMN translation_scroll REAL NOT NULL DEFAULT 0;
    ALTER TABLE reading_progress ADD COLUMN transcript_scroll REAL NOT NULL DEFAULT 0;
    ALTER TABLE reading_progress ADD COLUMN active_transcript_timestamp INTEGER;
  `,
}, {
  version: 3,
  name: "annotation_indexes",
  sql: `
    CREATE INDEX idx_annotations_week_page ON annotations(week_id, page_number, updated_at);
    CREATE INDEX idx_notes_week_updated ON notes(week_id, updated_at DESC);
  `,
}, {
  version: 4,
  name: "phase4_ai",
  sql: `
    CREATE TABLE ai_provider_settings (
      provider TEXT PRIMARY KEY, encrypted_api_key TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE transcript_translation_chunks (
      id TEXT PRIMARY KEY, week_id TEXT NOT NULL REFERENCES weeks(id) ON DELETE CASCADE, order_index INTEGER NOT NULL,
      source_text TEXT NOT NULL, source_hash TEXT NOT NULL, translated_text TEXT NOT NULL, provider TEXT NOT NULL,
      model TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(week_id, order_index, source_hash)
    );
    CREATE INDEX idx_translation_week_order ON transcript_translation_chunks(week_id, order_index);
    CREATE TABLE ai_analysis_runs (
      id TEXT PRIMARY KEY, week_id TEXT NOT NULL REFERENCES weeks(id) ON DELETE CASCADE, provider TEXT NOT NULL,
      model TEXT NOT NULL, source_hash TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE ai_chunk_results (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES ai_analysis_runs(id) ON DELETE CASCADE,
      stage TEXT NOT NULL, order_index INTEGER NOT NULL, source_hash TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE ai_study_notes (
      id TEXT PRIMARY KEY, week_id TEXT NOT NULL UNIQUE REFERENCES weeks(id) ON DELETE CASCADE, provider TEXT NOT NULL,
      model TEXT NOT NULL, source_hash TEXT NOT NULL, status TEXT NOT NULL, generated_content_json TEXT NOT NULL,
      edited_content_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `,
}, {
  version: 5,
  name: "ai_map_cache",
  sql: `
    CREATE TABLE ai_map_cache (
      id TEXT PRIMARY KEY, week_id TEXT NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      stage TEXT NOT NULL CHECK(stage IN ('pdf','transcript')), order_index INTEGER NOT NULL,
      source_hash TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
      result_json TEXT NOT NULL, duration_ms INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(week_id, stage, source_hash, provider, model)
    );
    CREATE INDEX idx_ai_map_cache_lookup ON ai_map_cache(week_id,stage,source_hash,provider,model);
  `,
}, {
  version: 6,
  name: "phase4_1_lecture_sessions",
  sql: `
    CREATE TABLE lecture_assets (
      id TEXT PRIMARY KEY, week_id TEXT NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('transcript_txt','timestamp_json')),
      original_name TEXT NOT NULL, managed_path TEXT NOT NULL, sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE lecture_sessions (
      id TEXT PRIMARY KEY, week_id TEXT NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      title TEXT NOT NULL, order_index INTEGER NOT NULL CHECK(order_index > 0),
      transcript_txt_asset_id TEXT REFERENCES lecture_assets(id) ON DELETE SET NULL,
      timestamp_json_asset_id TEXT REFERENCES lecture_assets(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(week_id, order_index)
    );
    CREATE INDEX idx_lecture_sessions_week_order ON lecture_sessions(week_id, order_index);
    CREATE INDEX idx_lecture_assets_week ON lecture_assets(week_id);

    INSERT INTO lecture_assets(id,week_id,kind,original_name,managed_path,sha256,size_bytes,created_at,updated_at)
      SELECT id,week_id,CASE kind WHEN 'transcript_json' THEN 'timestamp_json' ELSE 'transcript_txt' END,
             original_name,managed_path,sha256,size_bytes,created_at,updated_at
      FROM week_files WHERE kind IN ('transcript_txt','transcript_json');
    INSERT INTO lecture_sessions(id,week_id,title,order_index,transcript_txt_asset_id,timestamp_json_asset_id,created_at,updated_at)
      SELECT 'lecture-legacy-' || w.id,w.id,'Lecture 1',1,
        (SELECT id FROM week_files f WHERE f.week_id=w.id AND f.kind='transcript_txt'),
        (SELECT id FROM week_files f WHERE f.week_id=w.id AND f.kind='transcript_json'),
        w.created_at,w.updated_at
      FROM weeks w WHERE EXISTS (SELECT 1 FROM week_files f WHERE f.week_id=w.id AND f.kind IN ('transcript_txt','transcript_json'));

    ALTER TABLE transcript_translation_chunks RENAME TO transcript_translation_chunks_legacy;
    CREATE TABLE transcript_translation_chunks (
      id TEXT PRIMARY KEY, week_id TEXT NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      lecture_session_id TEXT NOT NULL REFERENCES lecture_sessions(id) ON DELETE CASCADE,
      order_index INTEGER NOT NULL, source_text TEXT NOT NULL, source_hash TEXT NOT NULL, translated_text TEXT NOT NULL,
      provider TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(lecture_session_id, order_index, source_hash)
    );
    INSERT INTO transcript_translation_chunks(id,week_id,lecture_session_id,order_index,source_text,source_hash,translated_text,provider,model,created_at,updated_at)
      SELECT t.id,t.week_id,'lecture-legacy-' || t.week_id,t.order_index,t.source_text,t.source_hash,t.translated_text,t.provider,t.model,t.created_at,t.updated_at
      FROM transcript_translation_chunks_legacy t
      WHERE EXISTS (SELECT 1 FROM lecture_sessions l WHERE l.id='lecture-legacy-' || t.week_id);
    DROP TABLE transcript_translation_chunks_legacy;
    CREATE INDEX idx_translation_lecture_order ON transcript_translation_chunks(lecture_session_id, order_index);

    ALTER TABLE ai_map_cache ADD COLUMN lecture_session_id TEXT;
    ALTER TABLE ai_map_cache ADD COLUMN lecture_title TEXT;
    UPDATE ai_map_cache SET lecture_session_id='lecture-legacy-' || week_id, lecture_title='Lecture 1'
      WHERE stage='transcript' AND EXISTS (SELECT 1 FROM lecture_sessions l WHERE l.id='lecture-legacy-' || ai_map_cache.week_id);
  `,
}];

export function runMigrations(db: Database.Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  const applied = new Set(db.prepare("SELECT version FROM schema_migrations").all().map((row) => (row as { version: number }).version));
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(migration.version, migration.name, new Date().toISOString());
    })();
  }
}
