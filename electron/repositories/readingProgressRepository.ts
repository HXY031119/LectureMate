import type Database from "better-sqlite3";
import type { LayoutMode, PdfFitMode, ReadingProgress } from "../../shared/domain";

interface ProgressRow {
  week_id: string; page_number: number; zoom: number; fit_mode: PdfFitMode; layout: LayoutMode;
  panel_sizes_json: string; translation_sync: number; translation_scroll: number; transcript_scroll: number;
  active_transcript_timestamp: number | null; updated_at: string;
}
const defaults = (weekId: string): ReadingProgress => ({ weekId, pageNumber: 1, zoom: 1, fitMode: "width", layout: "bilingual", panelSizes: [62, 38, 68, 32], translationSync: true, translationScroll: 0, transcriptScroll: 0, activeTranscriptTimestamp: null, updatedAt: new Date().toISOString() });

export class ReadingProgressRepository {
  constructor(private readonly db: Database.Database) {}
  get(weekId: string): ReadingProgress {
    const row = this.db.prepare("SELECT * FROM reading_progress WHERE week_id=?").get(weekId) as ProgressRow | undefined;
    if (!row) return defaults(weekId);
    let panelSizes = defaults(weekId).panelSizes;
    try { const parsed: unknown = JSON.parse(row.panel_sizes_json); if (Array.isArray(parsed) && parsed.every((n) => typeof n === "number")) panelSizes = parsed; } catch { /* use defaults */ }
    return { weekId: row.week_id, pageNumber: row.page_number, zoom: row.zoom, fitMode: row.fit_mode, layout: row.layout, panelSizes, translationSync: Boolean(row.translation_sync), translationScroll: row.translation_scroll, transcriptScroll: row.transcript_scroll, activeTranscriptTimestamp: row.active_transcript_timestamp, updatedAt: row.updated_at };
  }
  set(progress: ReadingProgress): ReadingProgress {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO reading_progress(week_id,page_number,zoom,fit_mode,layout,panel_sizes_json,translation_sync,translation_scroll,transcript_scroll,active_transcript_timestamp,updated_at)
      VALUES(@weekId,@pageNumber,@zoom,@fitMode,@layout,@panelSizes,@translationSync,@translationScroll,@transcriptScroll,@activeTranscriptTimestamp,@updatedAt)
      ON CONFLICT(week_id) DO UPDATE SET page_number=excluded.page_number,zoom=excluded.zoom,fit_mode=excluded.fit_mode,layout=excluded.layout,
      panel_sizes_json=excluded.panel_sizes_json,translation_sync=excluded.translation_sync,translation_scroll=excluded.translation_scroll,
      transcript_scroll=excluded.transcript_scroll,active_transcript_timestamp=excluded.active_transcript_timestamp,updated_at=excluded.updated_at`)
      .run({ ...progress, panelSizes: JSON.stringify(progress.panelSizes), translationSync: progress.translationSync ? 1 : 0, updatedAt: now });
    return this.get(progress.weekId);
  }
}
