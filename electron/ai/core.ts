import { createHash } from "node:crypto";
import type { Evidence, PdfPageContent, StudyNoteItem, TranscriptChunk, WeekStudyNotes } from "../../shared/domain";

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

export function chunkTranscript(weekId: string, text: string, limit = 3500, lectureSessionId = weekId, lectureTitle = "Lecture 1"): TranscriptChunk[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const units = normalized.split(/(?<=\n\n)|(?<=[.!?。！？])\s+|\n(?=\S)/).filter(Boolean);
  const chunks: string[] = [];
  for (const unit of units) {
    if (unit.trim().length <= limit) { chunks.push(unit.trim()); continue; }
    for (let start = 0; start < unit.length; start += limit) chunks.push(unit.slice(start, start + limit).trim());
  }
  return chunks.filter(Boolean).map((sourceText, orderIndex) => ({ id: `${lectureSessionId}:${orderIndex}:${sha256(sourceText).slice(0, 12)}`, weekId, lectureSessionId, lectureTitle, orderIndex, sourceText, sourceHash: sha256(sourceText) }));
}

export function chunkTranscriptForAnalysis(weekId: string, text: string, limit = 7000, lectureSessionId = weekId, lectureTitle = "Lecture 1"): TranscriptChunk[] {
  const sentences = chunkTranscript(weekId, text, limit, lectureSessionId, lectureTitle); const groups: string[] = []; let current = "";
  for (const sentence of sentences) { if (current && current.length + sentence.sourceText.length + 1 > limit) { groups.push(current); current = ""; } current += `${current ? " " : ""}${sentence.sourceText}`; }
  if (current) groups.push(current);
  return groups.map((sourceText, orderIndex) => ({ id: `${lectureSessionId}:analysis:${orderIndex}:${sha256(sourceText).slice(0, 12)}`, weekId, lectureSessionId, lectureTitle, orderIndex, sourceText, sourceHash: sha256(sourceText) }));
}

export function chunkPdfPages(pages: PdfPageContent[], limit = 7000): PdfPageContent[][] {
  const result: PdfPageContent[][] = []; let group: PdfPageContent[] = []; let size = 0;
  for (const page of pages) { if (group.length && size + page.text.length > limit) { result.push(group); group = []; size = 0; } group.push(page); size += page.text.length; }
  if (group.length) result.push(group); return result;
}

const evidenceSources = new Set(["pdf", "transcript", "annotation", "note"]);
function evidence(value: unknown): Evidence {
  if (typeof value === "string" && value.trim()) return { source: "transcript", text: value.trim() };
  if (!value || typeof value !== "object") throw new Error("依据格式无效");
  const v = value as Record<string, unknown>;
  const text = [v.text, v.quote, v.transcriptText].find((field) => typeof field === "string" && field.trim()) as string | undefined; if (!text) throw new Error("依据缺少正文"); const source = evidenceSources.has(String(v.source)) ? v.source as Evidence["source"] : Number.isInteger(v.pageNumber) ? "pdf" : "transcript";
  return { source, text, ...(Number.isInteger(v.pageNumber) ? { pageNumber: v.pageNumber as number } : {}), ...(typeof v.transcriptText === "string" ? { transcriptText: v.transcriptText } : {}), ...(Number.isInteger(v.transcriptStartMs) ? { transcriptStartMs: v.transcriptStartMs as number } : {}), ...(typeof v.lectureSessionId === "string" ? { lectureSessionId: v.lectureSessionId } : {}), ...(typeof v.lectureTitle === "string" ? { lectureTitle: v.lectureTitle } : {}) };
}
function items(value: unknown): StudyNoteItem[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("AI 返回的笔记栏目不是数组");
  return value.flatMap((raw): StudyNoteItem[] => { if (typeof raw === "string" && raw.trim()) return [{ title: raw.trim(), summary: raw.trim(), evidence: [] }]; if (!raw || typeof raw !== "object") return []; const v = raw as Record<string, unknown>; const title = [v.title, v.name, v.concept, v.formula, v.statement].find((field) => typeof field === "string" && field.trim()) as string | undefined; if (!title) return []; const summary = [v.summary, v.description, v.explanation, v.statement, v.text, title].find((field) => typeof field === "string") as string; const rawEvidence = Array.isArray(v.evidence) ? v.evidence : []; return [{ ...v, title, summary, evidence: rawEvidence.map(evidence) } as StudyNoteItem]; });
}
export function validateWeekStudyNotes(value: unknown, weekId: string): WeekStudyNotes {
  if (!value || typeof value !== "object") throw new Error("AI 未返回有效的结构化笔记"); const v = value as Record<string, unknown>;
  const coreConcepts = items(v.coreConcepts); const teacherEmphasis = items(v.teacherEmphasis); const summaryCandidate = [v.finalSummary, v.summary, v.conclusion].find((field) => typeof field === "string" && field.trim()) as string | undefined; const fallbackSummary = [...coreConcepts, ...teacherEmphasis].slice(0, 6).map((item) => item.summary).filter(Boolean).join("；"); const finalSummary = summaryCandidate ?? (fallbackSummary || "本周学习重点已完成结构化整理，请结合各栏目复习。");
  return { weekId, coreConcepts, teacherEmphasis, lectureAdditions: items(v.lectureAdditions), confusingConcepts: items(v.confusingConcepts), examples: items(v.examples), assessmentInfo: items(v.assessmentInfo), formulasAndDefinitions: items(v.formulasAndDefinitions), reviewPriorities: items(v.reviewPriorities), finalSummary };
}

export function mergeStudyNotes(weekId: string, parts: Partial<WeekStudyNotes>[]): WeekStudyNotes {
  const keys = ["coreConcepts","teacherEmphasis","lectureAdditions","confusingConcepts","examples","assessmentInfo","formulasAndDefinitions","reviewPriorities"] as const;
  const output = { weekId, finalSummary: "", ...Object.fromEntries(keys.map((k) => [k, []])) } as unknown as WeekStudyNotes;
  for (const key of keys) { const seen = new Set<string>(); output[key] = parts.flatMap((p) => p[key] ?? []).filter((item) => { const id = `${item.title}|${item.summary}`.toLocaleLowerCase(); if (seen.has(id)) return false; seen.add(id); return true; }); }
  output.finalSummary = parts.map((p) => p.finalSummary).filter(Boolean).join("\n"); return output;
}

export function normalizeProviderError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error); const clean = message.replace(/sk-[A-Za-z0-9_-]+/g, "[已隐藏]");
  if (/401|unauthor|api key/i.test(clean)) return new Error("API Key 无效或未获授权");
  if (/404|model.*not found/i.test(clean)) return new Error("模型不存在或当前不可用，请检查模型 ID");
  if (/429|rate limit/i.test(clean)) return new Error("请求过于频繁或免费模型额度暂不可用，请稍后重试");
  if (/timeout|abort/i.test(clean)) return new Error("AI 请求超时，请稍后重试");
  if (/fetch|network|ENOTFOUND|ECONN/i.test(clean)) return new Error("无法连接 AI 服务，请检查网络和 Base URL");
  return new Error(`AI 服务请求失败：${clean.slice(0, 240)}`);
}
