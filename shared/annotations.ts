import type { Annotation, AnnotationType, NormalizedPoint } from "./domain";

export interface AnnotationHistoryEntry { before: Annotation | null; after: Annotation | null }
export interface AnnotationHistoryTransition { entry: AnnotationHistoryEntry; history: AnnotationHistoryEntry[]; future: AnnotationHistoryEntry[] }

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const unit = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1;
const point = (value: unknown): value is NormalizedPoint => typeof value === "object" && value !== null && unit((value as { x?: unknown }).x) && unit((value as { y?: unknown }).y);
const base = (value: Record<string, unknown>): boolean => typeof value.id === "string" && typeof value.weekId === "string" && Number.isInteger(value.pageNumber) && (value.pageNumber as number) > 0 && typeof value.color === "string" && typeof value.createdAt === "string" && typeof value.updatedAt === "string";

export function isAnnotation(value: unknown): value is Annotation {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>; if (!base(item) || typeof item.type !== "string") return false;
  const box = unit(item.x) && unit(item.y) && finite(item.width) && finite(item.height) && finite(item.strokeWidth);
  if (["highlight", "rectangle", "ellipse"].includes(item.type)) return box;
  if (item.type === "pen") return Array.isArray(item.points) && item.points.length > 0 && item.points.every(point) && finite(item.strokeWidth);
  if (item.type === "arrow") return unit(item.startX) && unit(item.startY) && unit(item.endX) && unit(item.endY) && finite(item.strokeWidth);
  return item.type === "text" && unit(item.x) && unit(item.y) && typeof item.text === "string" && finite(item.strokeWidth);
}

export function annotationFromRecord(row: { id: string; week_id: string; page_number: number; type: string; payload_json: string; color: string; created_at: string; updated_at: string }): Annotation {
  let payload: unknown;
  try { payload = JSON.parse(row.payload_json); } catch { throw new Error("标注数据已损坏，无法读取"); }
  const candidate = { ...(typeof payload === "object" && payload !== null ? payload : {}), id: row.id, weekId: row.week_id, pageNumber: row.page_number, type: row.type as AnnotationType, color: row.color, createdAt: row.created_at, updatedAt: row.updated_at };
  if (!isAnnotation(candidate)) throw new Error("标注数据格式无效");
  return candidate;
}

export function annotationPayload(annotation: Annotation): string {
  const payload: Record<string, unknown> = { ...annotation };
  for (const key of ["id", "weekId", "pageNumber", "type", "color", "createdAt", "updatedAt"]) delete payload[key];
  return JSON.stringify(payload);
}

export function normalizePoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): NormalizedPoint {
  return { x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)) };
}

export function normalizedBox(start: NormalizedPoint, end: NormalizedPoint): { x: number; y: number; width: number; height: number } {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

export function takeUndo(history: AnnotationHistoryEntry[], future: AnnotationHistoryEntry[]): AnnotationHistoryTransition | null {
  const entry = history.at(-1); return entry ? { entry, history: history.slice(0, -1), future: [...future, entry] } : null;
}

export function takeRedo(history: AnnotationHistoryEntry[], future: AnnotationHistoryEntry[]): AnnotationHistoryTransition | null {
  const entry = future.at(-1); return entry ? { entry, history: [...history, entry], future: future.slice(0, -1) } : null;
}
