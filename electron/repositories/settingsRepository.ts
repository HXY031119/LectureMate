import type Database from "better-sqlite3";
import { DEFAULT_SETTINGS, type AppSettings } from "../../shared/domain";

export class SettingsRepository {
  constructor(private readonly db: Database.Database) {}
  get(): AppSettings {
    const row = this.db.prepare("SELECT value_json FROM settings WHERE key='app'").get() as { value_json: string } | undefined;
    if (!row) return { ...DEFAULT_SETTINGS };
    try { return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value_json) as Partial<AppSettings>) }; }
    catch { return { ...DEFAULT_SETTINGS }; }
  }
  set(settings: AppSettings): AppSettings {
    this.db.prepare(`INSERT INTO settings(key,value_json,updated_at) VALUES('app',?,?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`)
      .run(JSON.stringify(settings), new Date().toISOString());
    return settings;
  }
}

