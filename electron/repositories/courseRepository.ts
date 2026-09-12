import type Database from "better-sqlite3";
import type { Course } from "../../shared/domain";
import type { CourseInput } from "../../shared/contracts";

interface CourseRow { id: string; code: string; name: string; color: string; icon: string; created_at: string; updated_at: string }
const mapCourse = (row: CourseRow): Course => ({ id: row.id, code: row.code, name: row.name, color: row.color, icon: row.icon, createdAt: row.created_at, updatedAt: row.updated_at });

export class CourseRepository {
  constructor(private readonly db: Database.Database) {}
  list(): Course[] {
    return (this.db.prepare("SELECT * FROM courses ORDER BY updated_at DESC").all() as CourseRow[]).map(mapCourse);
  }
  find(id: string): Course | undefined {
    const row = this.db.prepare("SELECT * FROM courses WHERE id = ?").get(id) as CourseRow | undefined;
    return row ? mapCourse(row) : undefined;
  }
  create(id: string, input: CourseInput, now: string): Course {
    this.db.prepare("INSERT INTO courses(id, code, name, color, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, input.code, input.name, input.color, input.icon, now, now);
    return this.find(id)!;
  }
  update(id: string, input: CourseInput, now: string): Course | undefined {
    const result = this.db.prepare("UPDATE courses SET code=?, name=?, color=?, icon=?, updated_at=? WHERE id=?")
      .run(input.code, input.name, input.color, input.icon, now, id);
    return result.changes ? this.find(id) : undefined;
  }
  delete(id: string): boolean { return this.db.prepare("DELETE FROM courses WHERE id = ?").run(id).changes > 0; }
}

