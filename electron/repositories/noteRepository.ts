import type Database from "better-sqlite3";
import type { Note } from "../../shared/domain";

interface NoteRow { id: string; course_id: string | null; week_id: string | null; kind: Note["kind"]; content: string; pdf_page: number | null; transcript_start_ms: number | null; annotation_id: string | null; created_at: string; updated_at: string }
const map = (row: NoteRow): Note => ({ id: row.id, courseId: row.course_id ?? undefined, weekId: row.week_id ?? undefined, kind: row.kind, content: row.content, pdfPage: row.pdf_page ?? undefined, transcriptStartMs: row.transcript_start_ms ?? undefined, annotationId: row.annotation_id ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at });
export class NoteRepository {
  constructor(private readonly db: Database.Database) {}
  list(weekId: string): Note[] { return (this.db.prepare("SELECT * FROM notes WHERE week_id=? ORDER BY updated_at DESC").all(weekId) as NoteRow[]).map(map); }
  find(id: string): Note | undefined { const row = this.db.prepare("SELECT * FROM notes WHERE id=?").get(id) as NoteRow | undefined; return row ? map(row) : undefined; }
  save(note: Note): Note {
    this.db.prepare(`INSERT INTO notes(id,course_id,week_id,kind,content,pdf_page,transcript_start_ms,annotation_id,created_at,updated_at) VALUES(@id,@courseId,@weekId,@kind,@content,@pdfPage,@transcriptStartMs,@annotationId,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,content=excluded.content,pdf_page=excluded.pdf_page,transcript_start_ms=excluded.transcript_start_ms,annotation_id=excluded.annotation_id,updated_at=excluded.updated_at`).run(note);
    return this.list(note.weekId!).find((item) => item.id === note.id)!;
  }
  delete(id: string): boolean { return this.db.prepare("DELETE FROM notes WHERE id=?").run(id).changes > 0; }
}
