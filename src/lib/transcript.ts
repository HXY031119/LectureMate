import type { RawTranscriptWord, TranscriptSegment, TranscriptWord } from "../../shared/domain";

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }

export function parseTranscriptJson(input: string): TranscriptWord[] {
  let parsed: unknown;
  try { parsed = JSON.parse(input.replace(/^\uFEFF/, "")); }
  catch { throw new Error("课堂字幕 JSON 格式不正确，无法解析"); }
  if (!Array.isArray(parsed)) throw new Error("课堂字幕 JSON 的顶层结构必须是数组");
  return parsed.map((value, position) => {
    if (!isRecord(value) || typeof value.i !== "number" || typeof value.w !== "string" || typeof value.s !== "number" || typeof value.e !== "number") {
      throw new Error(`课堂字幕 JSON 第 ${position + 1} 项缺少必要字段 i、w、s 或 e`);
    }
    if (!Number.isFinite(value.s) || !Number.isFinite(value.e) || value.s < 0 || value.e < value.s) {
      throw new Error(`课堂字幕 JSON 第 ${position + 1} 项的时间范围无效`);
    }
    const raw: RawTranscriptWord = { i: value.i, w: value.w, s: value.s, e: value.e };
    if (typeof value.t === "string") raw.t = value.t;
    if (typeof value.a === "number") raw.a = value.a;
    return { index: raw.i, text: raw.w, startMs: raw.s, endMs: raw.e, raw };
  });
}

function joinWords(words: TranscriptWord[]): string {
  return words.reduce((text, word) => {
    const value = word.text.trim();
    if (!value) return text;
    if (!text || /^[,.;:!?%\])}，。；：！？、]/.test(value)) return text + value;
    return `${text} ${value}`;
  }, "");
}

export function segmentTranscript(words: TranscriptWord[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: TranscriptWord[] = [];
  const flush = () => {
    if (!current.length) return;
    const startMs = current[0].startMs;
    segments.push({ id: `segment-${startMs}-${segments.length}`, startMs, endMs: current[current.length - 1].endMs, text: joinWords(current), words: current });
    current = [];
  };
  for (const word of words) {
    const previous = current[current.length - 1];
    if (previous && word.startMs - previous.endMs > 1800) flush();
    current.push(word);
    const duration = current[current.length - 1].endMs - current[0].startMs;
    const text = joinWords(current);
    if (/[.!?。！？]["'”’)]?$/.test(word.text.trim()) || duration >= 16000 || text.length >= 240) flush();
  }
  flush();
  return segments;
}

export function formatTranscriptTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0 ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function seekToTranscriptTime(ms: number): number { return Math.max(0, ms); }
