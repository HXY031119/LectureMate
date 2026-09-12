# LectureMate architecture

## Final architecture

LectureMate uses a three-process boundary:

- **Electron main** owns the app lifecycle, SQLite connection, migrations, local filesystem, native dialogs, and validated IPC handlers.
- **Preload** exposes a narrow, typed `window.lectureMate` API. The renderer never receives Node.js primitives or arbitrary filesystem access.
- **React renderer** owns presentation and UI state. Persistent state is fetched and mutated through the preload API.

Data follows `Course -> Week -> Learning Materials`. SQLite stores metadata and small structured records; immutable source files are copied into an application-managed directory. Repositories isolate SQL, services enforce invariants and coordinate filesystem work, and IPC is the transport boundary. Future reader, annotation, alignment, and AI modules plug into these boundaries without changing Course/Week identity.

The managed data layout is:

```text
<appData>/LectureMate/
├── database.sqlite
├── database.sqlite-wal
├── courses/
│   └── <course-id>/
│       └── <week-id>/
│           ├── original.pdf
│           ├── translation.txt
│           ├── transcript.txt
│           └── transcript.json
└── cache/
```

Source files are copied, never edited. Renderer requests use IDs and declared operations, not paths supplied to arbitrary file APIs. IDs are UUIDs; timestamps are ISO-8601 UTC strings. Deleting a course or week cascades its database records and removes only its resolved managed directory.

## Directory structure

```text
LectureMate/
├── docs/architecture.md
├── electron/
│   ├── database/
│   │   ├── connection.ts
│   │   └── migrations.ts
│   ├── repositories/
│   │   ├── courseRepository.ts
│   │   ├── settingsRepository.ts
│   │   └── weekRepository.ts
│   ├── services/
│   │   └── lectureMateService.ts
│   ├── ipc.ts
│   ├── main.ts
│   └── preload.ts
├── shared/
│   ├── contracts.ts
│   └── domain.ts
├── src/
│   ├── components/
│   ├── lib/
│   ├── App.tsx
│   ├── index.css
│   ├── main.tsx
│   └── vite-env.d.ts
├── tests/
├── index.html
├── package.json
├── tsconfig*.json
└── vite.config.ts
```

## SQLite schema

Migrations are transactional and recorded in `schema_migrations`. Phase 1 actively uses courses, weeks, week_files, reading_progress, and settings. Later tables are created now so their identity and relationships are stable, but no Phase 2–5 behavior is implemented.

```sql
courses(id PK, code, name, color, icon, created_at, updated_at)
weeks(id PK, course_id FK, name, position, created_at, updated_at)
week_files(id PK, week_id FK, kind, original_name, managed_path, sha256, size_bytes, created_at, updated_at, UNIQUE(week_id, kind))
reading_progress(week_id PK/FK, page_number, zoom, layout, panel_sizes_json, updated_at)
annotations(id PK, week_id FK, page_number, type, payload_json, color, created_at, updated_at)
notes(id PK, course_id FK?, week_id FK?, kind, content, pdf_page?, transcript_start_ms?, annotation_id?, created_at, updated_at)
transcript_segments(id PK, week_id FK, start_ms, end_ms, raw_text, corrected_text?, words_json, created_at)
page_transcript_alignments(id PK, week_id FK, page_number, transcript_start_ms, transcript_end_ms, confidence, method, created_at, updated_at)
ai_insights(id PK, course_id FK, week_id FK, type, title, summary, importance, confidence, page_numbers_json, transcript_start_ms?, transcript_end_ms?, evidence_json, source_type, created_at)
settings(key PK, value_json, updated_at)
```

Foreign keys are enabled. Course/week children cascade on deletion. File deletion is performed after the database transaction and constrained to the managed courses root.

## Domain interfaces

Canonical TypeScript interfaces live in `shared/domain.ts`: `Course`, `Week`, `WeekFile`, `ReadingProgress`, `AppSettings`, plus future `Annotation`, `Note`, `TranscriptWord`, `TranscriptSegment`, `PageTranscriptAlignment`, and `LectureInsight`. IPC request/response contracts live in `shared/contracts.ts` and use an `AppResult<T>` discriminated union so expected failures render in the UI instead of causing a white screen.

## Phase 1 implementation plan

1. Scaffold strict TypeScript builds for Electron main/preload and React/Vite renderer.
2. Initialize the managed app-data folders and migrated WAL-mode SQLite database.
3. Implement repository/service layers for Course and Week CRUD, settings, restoration, and managed imports.
4. Expose a typed, context-isolated IPC API with native file dialogs.
5. Build a compact desktop UI with Course/Week navigation, CRUD dialogs, import/status controls, empty states, error boundary, and light/dark/system themes.
6. Test repositories and service invariants, then run lint, typecheck, tests, and production build.

## Architecture review

- `better-sqlite3` is synchronous by design; Phase 1 queries are tiny and stay in Electron main. Heavy extraction/AI work later must use workers so main is not blocked.
- Managed paths are stored as paths for portability within one app-data root. A future relocation migration should rewrite them; hashes allow integrity checks and deduplication.
- Database cascades cannot atomically include filesystem deletion. The service commits database deletion first and then best-effort removes only the scoped managed folder. A future cleanup job can remove orphan directories after a crash.
- Settings are schema-tolerant JSON values, while important relational state remains normalized. Runtime decoding applies defaults when settings are missing or old.
- Native modules must match Electron's ABI. `postinstall` rebuilds `better-sqlite3` for Electron.
- Phase 2 parsers and Phase 3 serialization tests named in the master brief belong to their respective phases; Phase 1 tests cover Course/Week CRUD, settings, and managed import behavior only.

## Phase 2 reader

Phase 2 keeps the Phase 1 ownership boundaries. Electron main reads only files already registered under managed storage and returns their bytes/text through typed IPC. The renderer cannot request arbitrary paths.

PDF.js creates one `PDFDocumentProxy` per Reader session. Only the active page is rendered at reading resolution; thumbnail canvases use `IntersectionObserver` and render at low resolution only when near the visible thumbnail viewport. The PDF page wrapper is a stable coordinate container with a dedicated `annotation-overlay`, ready for normalized Phase 3 coordinates without implementing annotations now.

Translation and transcript parsing are pure modules under `src/lib`. Parsed results are memoized in Reader state after material loading instead of being recomputed on React renders. JSON transcript data is normalized while preserving every supported raw field, then segmented locally using punctuation, word gaps, duration, and length.

Migration 2 extends `reading_progress` with `fit_mode`, translation sync/scroll, transcript scroll, and active transcript timestamp. Existing rows receive safe defaults. Layout and panel proportions continue to be stored per Week. Renderer changes are debounced before IPC persistence.

Phase 2 intentionally excludes annotations, semantic PDF/transcript alignment, AI analysis, exam review, and video playback.

## Phase 3 annotations and notes

Migration 3 adds indexes for the Phase 3 access pattern: annotations are fetched only by `(week_id, page_number)`, while notes are fetched by Week and recency. Existing `annotations` and `notes` tables remain unchanged, so Phase 1/2 user data is preserved.

Annotation geometry is stored in `payload_json` using normalized coordinates in the inclusive 0–1 page coordinate system. The page container remains the stable PDF coordinate layer and renders annotations with an SVG `viewBox="0 0 1 1"` directly above the PDF canvas. Shape boxes store `x/y/width/height`, pens store a normalized point list, arrows store normalized endpoints, and text stores a normalized anchor. As a result the overlay remains aligned across zoom, fit modes, window resizes, and device pixel ratios.

The renderer keeps a current-page annotation cache and a session-local undo/redo command history. Every create, change, move, color edit, text edit, delete, undo, and redo is immediately synchronized through typed IPC to SQLite. The `notes` repository supports Week, page, transcript, and annotation notes with automatic association fields; UI edits save on focus loss.

Phase 3 deliberately does not implement partial pen erasing, shape resize handles, PDF text-range highlights, cloud sync, semantic alignment, AI, translation lookup, or video playback.
