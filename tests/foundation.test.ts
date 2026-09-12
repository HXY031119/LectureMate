import Database from "better-sqlite3";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../electron/database/migrations";
import { LectureMateService } from "../electron/services/lectureMateService";

describe("Phase 1 foundation", () => {
  let db: Database.Database;
  let root: string;
  let service: LectureMateService;

  beforeEach(() => {
    root = join(tmpdir(), `lecturemate-${randomUUID()}`);
    const coursesRoot = join(root, "courses");
    mkdirSync(coursesRoot, { recursive: true });
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    service = new LectureMateService(db, coursesRoot, root);
  });
  afterEach(() => { db?.close(); if (root) rmSync(root, { recursive: true, force: true }); });

  it("creates, updates, lists, and deletes a course", () => {
    const course = service.createCourse({ code: "EE6111", name: "5G Communication", color: "#5b6ee1", icon: "BookOpen" });
    expect(service.getTree()[0]).toMatchObject({ id: course.id, code: "EE6111" });
    service.updateCourse(course.id, { code: "EE6111", name: "5G and Beyond", color: "#169b83", icon: "BookOpen" });
    expect(service.courses.find(course.id)?.name).toBe("5G and Beyond");
    service.deleteCourse(course.id);
    expect(service.getTree()).toEqual([]);
  });

  it("assigns default week names and cascades weeks with courses", () => {
    const course = service.createCourse({ code: "EE6405", name: "Machine Learning", color: "#5b6ee1", icon: "BookOpen" });
    const first = service.createWeek(course.id);
    const second = service.createWeek(course.id, "Week 2 - Regression");
    expect([first.name, second.position]).toEqual(["第 1 周", 2]);
    service.updateWeek(first.id, "Week 1 - Introduction");
    expect(service.weeks.find(first.id)?.name).toBe("Week 1 - Introduction");
    service.deleteCourse(course.id);
    expect(service.weeks.list()).toEqual([]);
  });

  it("copies an immutable source into managed storage and records its hash", () => {
    const course = service.createCourse({ code: "CS", name: "Systems", color: "#5b6ee1", icon: "BookOpen" });
    const week = service.createWeek(course.id);
    const source = join(root, "notes.txt"); writeFileSync(source, "original transcript");
    const file = service.importFile(week.id, "transcript_txt", source);
    writeFileSync(source, "changed source");
    expect(readFileSync(file.managedPath, "utf8")).toBe("original transcript");
    expect(file.sha256).toHaveLength(64);
  });

  it("persists and repairs restored selection", () => {
    const course = service.createCourse({ code: "MA", name: "Math", color: "#5b6ee1", icon: "BookOpen" });
    const week = service.createWeek(course.id);
    service.updateSettings({ theme: "dark", lastCourseId: course.id, lastWeekId: week.id });
    expect(service.settings.get()).toMatchObject({ theme: "dark", lastWeekId: week.id });
    service.deleteWeek(week.id);
    expect(service.settings.get()).toMatchObject({ lastCourseId: null, lastWeekId: null });
  });

  it("按周次持久化并恢复阅读状态", () => {
    const course = service.createCourse({ code: "PHY", name: "物理", color: "#5b6ee1", icon: "BookOpen" });
    const week = service.createWeek(course.id);
    const saved = service.updateReadingProgress({ weekId: week.id, pageNumber: 27, zoom: 1.4, fitMode: "custom", layout: "lecture-review", panelSizes: [64, 36, 70, 30], translationSync: false, translationScroll: 318, transcriptScroll: 902, activeTranscriptTimestamp: 754000, updatedAt: new Date().toISOString() });
    expect(saved).toMatchObject({ pageNumber: 27, fitMode: "custom", translationSync: false, transcriptScroll: 902, activeTranscriptTimestamp: 754000 });
    expect(service.readingProgress.get(week.id).panelSizes).toEqual([64, 36, 70, 30]);
  });
});
