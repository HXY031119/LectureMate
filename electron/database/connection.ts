import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { runMigrations } from "./migrations";

export interface DatabaseContext { db: Database.Database; dataRoot: string; coursesRoot: string }

export function openDatabase(appDataPath: string): DatabaseContext {
  const dataRoot = join(appDataPath, "LectureMate");
  const coursesRoot = join(dataRoot, "courses");
  mkdirSync(coursesRoot, { recursive: true });
  mkdirSync(join(dataRoot, "cache"), { recursive: true });
  const db = new Database(join(dataRoot, "database.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  runMigrations(db);
  return { db, dataRoot, coursesRoot };
}
