import type Database from "better-sqlite3";
import { annotationFromRecord, annotationPayload } from "../../shared/annotations";
import type { Annotation } from "../../shared/domain";

interface AnnotationRow { id: string; week_id: string; page_number: number; type: string; payload_json: string; color: string; created_at: string; updated_at: string }

export class AnnotationRepository {
  constructor(private readonly db: Database.Database) {}
  list(weekId: string, pageNumber: number): Annotation[] {
    return (this.db.prepare("SELECT * FROM annotations WHERE week_id=? AND page_number=? ORDER BY created_at").all(weekId, pageNumber) as AnnotationRow[]).map(annotationFromRecord);
  }
  save(annotation: Annotation): Annotation {
    this.db.prepare(`INSERT INTO annotations(id,week_id,page_number,type,payload_json,color,created_at,updated_at) VALUES(@id,@weekId,@pageNumber,@type,@payload,@color,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,color=excluded.color,updated_at=excluded.updated_at`).run({ ...annotation, payload: annotationPayload(annotation) });
    return this.list(annotation.weekId, annotation.pageNumber).find((item) => item.id === annotation.id)!;
  }
  delete(id: string): boolean { return this.db.prepare("DELETE FROM annotations WHERE id=?").run(id).changes > 0; }
}
