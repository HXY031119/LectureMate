import Database from "better-sqlite3";
import { mkdirSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { annotationFromRecord, annotationPayload, normalizePoint, normalizedBox, takeRedo, takeUndo } from "../shared/annotations";
import type { Annotation } from "../shared/domain";
import { runMigrations } from "../electron/database/migrations";
import { LectureMateService } from "../electron/services/lectureMateService";

describe("Phase 3 标注与笔记", () => {
  let db: Database.Database; let root: string; let service: LectureMateService; let weekId: string; let secondWeekId: string;
  beforeEach(() => {
    root = join(tmpdir(), `lecturemate-annotation-${randomUUID()}`); const coursesRoot = join(root, "courses"); mkdirSync(coursesRoot, { recursive: true });
    db = new Database(":memory:"); db.pragma("foreign_keys = ON"); runMigrations(db); service = new LectureMateService(db, coursesRoot, root);
    const course = service.createCourse({ code: "EE", name: "测试", color: "#5b6ee1", icon: "BookOpen" }); weekId = service.createWeek(course.id).id; secondWeekId = service.createWeek(course.id).id;
  });
  afterEach(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  const rectangle = (): Annotation => ({ id: randomUUID(), weekId, pageNumber: 2, type: "rectangle", x: .1, y: .2, width: .3, height: .4, strokeWidth: 2, color: "#f2c94c", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });

  it("序列化并反序列化归一化标注", () => {
    const annotation = rectangle(); const payload = annotationPayload(annotation);
    const restored = annotationFromRecord({ id: annotation.id, week_id: weekId, page_number: 2, type: "rectangle", payload_json: payload, color: annotation.color, created_at: annotation.createdAt, updated_at: annotation.updatedAt });
    expect(restored).toEqual(annotation);
    expect(() => annotationFromRecord({ id: "x", week_id: weekId, page_number: 1, type: "pen", payload_json: "{}", color: "#fff", created_at: "x", updated_at: "x" })).toThrow("格式无效");
  });

  it("将屏幕坐标稳定转换为归一化坐标", () => {
    expect(normalizePoint(150, 250, { left: 50, top: 50, width: 200, height: 400 })).toEqual({ x: .5, y: .5 });
    expect(normalizedBox({ x: .9, y: .8 }, { x: .2, y: .3 })).toEqual({ x: .2, y: .3, width: .7, height: .5 });
  });

  it("Undo / Redo 保持正确顺序，并在新操作后清空重做记录", () => {
    const created = rectangle(); const recolored = { ...created, color: "#3584e4" } as Annotation;
    const undone = takeUndo([{ before: null, after: created }, { before: created, after: recolored }], []);
    expect(undone).toMatchObject({ entry: { before: created, after: recolored }, history: [{ before: null, after: created }], future: [{ before: created, after: recolored }] });
    const redone = takeRedo(undone!.history, undone!.future);
    expect(redone).toMatchObject({ entry: { before: created, after: recolored }, history: [{ before: null, after: created }, { before: created, after: recolored }], future: [] });
  });

  it("按页过滤、更新和删除标注", () => {
    const pageTwo = rectangle(); const pageThree = { ...rectangle(), pageNumber: 3 } as Annotation;
    service.saveAnnotation(pageTwo); service.saveAnnotation(pageThree);
    expect(service.listAnnotations(weekId, 2)[0]).toMatchObject({ id: pageTwo.id, weekId, pageNumber: 2, type: "rectangle", x: .1, y: .2, width: .3, height: .4 });
    const changed = { ...pageTwo, color: "#3584e4" } as Annotation; service.saveAnnotation(changed);
    expect(service.listAnnotations(weekId, 2)[0].color).toBe("#3584e4");
    service.deleteAnnotation(pageTwo.id); expect(service.listAnnotations(weekId, 2)).toEqual([]);
  });

  it("严格隔离不同 Week 与 PDF 页的标注", () => {
    const weekOnePageOne = { ...rectangle(), pageNumber: 1 } as Annotation;
    const weekOnePageTwo = rectangle();
    const weekTwoPageOne = { ...rectangle(), id: randomUUID(), weekId: secondWeekId, pageNumber: 1 } as Annotation;
    service.saveAnnotation(weekOnePageOne); service.saveAnnotation(weekOnePageTwo); service.saveAnnotation(weekTwoPageOne);
    expect(service.listAnnotations(weekId, 1).map((item) => item.id)).toEqual([weekOnePageOne.id]);
    expect(service.listAnnotations(weekId, 2).map((item) => item.id)).toEqual([weekOnePageTwo.id]);
    expect(service.listAnnotations(secondWeekId, 1).map((item) => item.id)).toEqual([weekTwoPageOne.id]);
  });

  it("创建、编辑和删除笔记", () => {
    const created = service.saveNote({ weekId, kind: "page", content: "第一页重点", pdfPage: 1 });
    expect(service.listNotes(weekId)[0]).toMatchObject({ id: created.id, pdfPage: 1, kind: "page" });
    const updated = service.saveNote({ id: created.id, weekId, kind: "page", content: "已修改", pdfPage: 1 });
    expect(updated).toMatchObject({ content: "已修改", createdAt: created.createdAt }); service.deleteNote(created.id); expect(service.listNotes(weekId)).toEqual([]);
  });

  it("保存笔记时验证四种作用域及关联目标", () => {
    const annotation = { ...rectangle(), pageNumber: 1 } as Annotation; service.saveAnnotation(annotation);
    const week = service.saveNote({ weekId, kind: "week", content: "周次" });
    const page = service.saveNote({ weekId, kind: "page", content: "页面", pdfPage: 1 });
    const transcript = service.saveNote({ weekId, kind: "transcript", content: "字幕", transcriptStartMs: 1200 });
    const annotationNote = service.saveNote({ weekId, kind: "annotation", content: "标注", annotationId: annotation.id });
    expect([week, page, transcript, annotationNote]).toMatchObject([{ kind: "week" }, { pdfPage: 1 }, { transcriptStartMs: 1200 }, { annotationId: annotation.id }]);
    expect(() => service.saveNote({ weekId, kind: "page", content: "无页码" })).toThrow("页码");
    expect(() => service.saveNote({ weekId, kind: "transcript", content: "无时间" })).toThrow("时间");
    expect(() => service.saveNote({ weekId, kind: "annotation", content: "无标注" })).toThrow("选择");
    expect(() => service.saveNote({ weekId: secondWeekId, kind: "annotation", content: "跨周标注" , annotationId: annotation.id })).toThrow("无效");
  });

  it("持久化标注偏好并保留默认阅读模式所需状态", () => {
    const settings = service.updateSettings({ annotationTool: "pen", annotationColor: "#3584e4", annotationStrokeWidth: 5 });
    expect(service.settings.get()).toMatchObject({ annotationTool: "pen", annotationColor: "#3584e4", annotationStrokeWidth: 5 });
    expect(settings).not.toHaveProperty("annotationMode");
  });
});
