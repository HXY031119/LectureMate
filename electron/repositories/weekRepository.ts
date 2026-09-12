import type Database from "better-sqlite3";
import type { Week, WeekFile, WeekFileKind } from "../../shared/domain";

interface WeekRow { id: string; course_id: string; name: string; position: number; created_at: string; updated_at: string }
interface FileRow { id: string; week_id: string; kind: WeekFileKind; original_name: string; managed_path: string; sha256: string; size_bytes: number; created_at: string; updated_at: string }
const mapWeek = (r: WeekRow): Week => ({ id: r.id, courseId: r.course_id, name: r.name, position: r.position, createdAt: r.created_at, updatedAt: r.updated_at });
const mapFile = (r: FileRow): WeekFile => ({ id: r.id, weekId: r.week_id, kind: r.kind, originalName: r.original_name, managedPath: r.managed_path, sha256: r.sha256, sizeBytes: r.size_bytes, createdAt: r.created_at, updatedAt: r.updated_at });

export class WeekRepository {
  constructor(private readonly db: Database.Database) {}
  list(courseId?: string): Week[] {
    const rows = courseId
      ? this.db.prepare("SELECT * FROM weeks WHERE course_id=? ORDER BY position").all(courseId)
      : this.db.prepare("SELECT * FROM weeks ORDER BY course_id, position").all();
    return (rows as WeekRow[]).map(mapWeek);
  }
  find(id: string): Week | undefined {
    const row = this.db.prepare("SELECT * FROM weeks WHERE id=?").get(id) as WeekRow | undefined;
    return row ? mapWeek(row) : undefined;
  }
  nextPosition(courseId: string): number {
    const row = this.db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS position FROM weeks WHERE course_id=?").get(courseId) as { position: number };
    return row.position;
  }
  create(id: string, courseId: string, name: string, position: number, now: string): Week {
    this.db.prepare("INSERT INTO weeks(id,course_id,name,position,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(id, courseId, name, position, now, now);
    return this.find(id)!;
  }
  update(id: string, name: string, now: string): Week | undefined {
    const result = this.db.prepare("UPDATE weeks SET name=?, updated_at=? WHERE id=?").run(name, now, id);
    return result.changes ? this.find(id) : undefined;
  }
  delete(id: string): boolean { return this.db.prepare("DELETE FROM weeks WHERE id=?").run(id).changes > 0; }
  listFiles(weekId?: string): WeekFile[] {
    const rows = weekId ? this.db.prepare("SELECT * FROM week_files WHERE week_id=?").all(weekId) : this.db.prepare("SELECT * FROM week_files").all();
    return (rows as FileRow[]).map(mapFile);
  }
  upsertFile(file: WeekFile): WeekFile {
    this.db.prepare(`INSERT INTO week_files(id,week_id,kind,original_name,managed_path,sha256,size_bytes,created_at,updated_at)
      VALUES(@id,@weekId,@kind,@originalName,@managedPath,@sha256,@sizeBytes,@createdAt,@updatedAt)
      ON CONFLICT(week_id,kind) DO UPDATE SET original_name=excluded.original_name, managed_path=excluded.managed_path,
      sha256=excluded.sha256, size_bytes=excluded.size_bytes, updated_at=excluded.updated_at`)
      .run(file);
    return this.listFiles(file.weekId).find((item) => item.kind === file.kind)!;
  }
}

