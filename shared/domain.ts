export type Theme = "light" | "dark" | "system";
export type LayoutMode = "bilingual" | "pdf-focus" | "lecture-review";
export type PdfFitMode = "custom" | "width" | "page";
export type WeekFileKind = "pdf" | "translation" | "transcript_txt" | "transcript_json";

export interface Course {
  id: string;
  code: string;
  name: string;
  color: string;
  icon: string;
  createdAt: string;
  updatedAt: string;
}

export interface Week {
  id: string;
  courseId: string;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface WeekFile {
  id: string;
  weekId: string;
  kind: WeekFileKind;
  originalName: string;
  managedPath: string;
  sha256: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}
export type LectureAssetKind = "transcript_txt" | "timestamp_json";
export interface LectureAsset { id: string; weekId: string; kind: LectureAssetKind; originalName: string; managedPath: string; sha256: string; sizeBytes: number; createdAt: string; updatedAt: string }
export interface LectureSession { id: string; weekId: string; title: string; orderIndex: number; transcriptTxtAssetId: string | null; timestampJsonAssetId: string | null; transcriptAsset: LectureAsset | null; timestampAsset: LectureAsset | null; createdAt: string; updatedAt: string }
export interface LectureMaterials { lecture: LectureSession; transcriptText: string | null; transcriptJson: string | null }

export interface WeekWithFiles extends Week {
  files: WeekFile[];
}

export interface CourseTree extends Course {
  weeks: WeekWithFiles[];
}

export interface ReadingProgress {
  weekId: string;
  pageNumber: number;
  zoom: number;
  fitMode: PdfFitMode;
  layout: LayoutMode;
  panelSizes: number[];
  translationSync: boolean;
  translationScroll: number;
  transcriptScroll: number;
  activeTranscriptTimestamp: number | null;
  updatedAt: string;
}

export interface TranslationPage { pageNumber: number; content: string }

export interface RawTranscriptWord {
  i: number;
  w: string;
  s: number;
  e: number;
  t?: string;
  a?: number;
}

export interface AppSettings {
  theme: Theme;
  lastCourseId: string | null;
  lastWeekId: string | null;
  layout: LayoutMode;
  annotationTool: AnnotationTool;
  annotationColor: string;
  annotationStrokeWidth: number;
  aiProvider: "openrouter";
  aiModel: string;
  aiBaseUrl: string;
  aiConsentAccepted: boolean;
  aiConcurrency: number;
  aiRouting: "default" | "latency" | "throughput";
}

export interface AISettings { provider: "openrouter"; model: string; baseUrl: string; hasApiKey: boolean; consentAccepted: boolean; concurrency: number; routing: "default" | "latency" | "throughput" }
export interface TranscriptChunk { id: string; weekId: string; lectureSessionId: string; lectureTitle: string; orderIndex: number; sourceText: string; sourceHash: string }
export interface TranscriptTranslationChunk extends TranscriptChunk { translatedText: string; provider: string; model: string; createdAt: string; updatedAt: string }
export interface TranslationStatus { sourceChunks: TranscriptChunk[]; chunks: TranscriptTranslationChunk[]; total: number; sourceHash: string | null; stale: boolean }
export interface PdfPageContent { pageNumber: number; text: string }
export interface Evidence { source: "pdf" | "transcript" | "annotation" | "note"; pageNumber?: number; transcriptText?: string; text: string; transcriptStartMs?: number; lectureSessionId?: string; lectureTitle?: string }
export interface StudyNoteItem { title: string; summary: string; importance?: number; confidence?: number; emphasisType?: string; reasons?: string[]; relatedPages?: number[]; statement?: string; type?: string; explicitness?: "explicit" | "inferred"; expression?: string; meaning?: string; variables?: string[]; evidence: Evidence[] }
export interface WeekStudyNotes {
  weekId: string;
  coreConcepts: StudyNoteItem[]; teacherEmphasis: StudyNoteItem[]; lectureAdditions: StudyNoteItem[];
  confusingConcepts: StudyNoteItem[]; examples: StudyNoteItem[]; assessmentInfo: StudyNoteItem[];
  formulasAndDefinitions: StudyNoteItem[]; reviewPriorities: StudyNoteItem[]; finalSummary: string;
}
export interface StoredWeekStudyNotes { id: string; weekId: string; provider: string; model: string; sourceHash: string; status: "complete" | "partial" | "failed"; generatedContent: WeekStudyNotes; editedContent: WeekStudyNotes | null; createdAt: string; updatedAt: string }
export interface AIAnalysisProgress { weekId: string; completed: number; total: number; pdfCompleted: number; pdfTotal: number; transcriptCompleted: number; transcriptTotal: number; cacheHits: number; requests: number; stage: "preparing" | "pdf" | "transcript" | "merging" | "generating" | "complete" | "cancelled"; message: string }
export interface AiAnalysisJob { id: string; weekId: string; status: "queued" | "running" | "completed" | "failed" | "cancelled"; progress: AIAnalysisProgress; startedAt: string; completedAt?: string; error?: string }

export type AnnotationType = "highlight" | "pen" | "rectangle" | "ellipse" | "arrow" | "text";
export interface NormalizedPoint { x: number; y: number }
export interface AnnotationBase {
  id: string;
  weekId: string;
  pageNumber: number;
  type: AnnotationType;
  color: string;
  createdAt: string;
  updatedAt: string;
}
export interface BoxAnnotation extends AnnotationBase { type: "highlight" | "rectangle" | "ellipse"; x: number; y: number; width: number; height: number; strokeWidth: number }
export interface PenAnnotation extends AnnotationBase { type: "pen"; points: NormalizedPoint[]; strokeWidth: number }
export interface ArrowAnnotation extends AnnotationBase { type: "arrow"; startX: number; startY: number; endX: number; endY: number; strokeWidth: number }
export interface TextAnnotation extends AnnotationBase { type: "text"; x: number; y: number; text: string; strokeWidth: number }
export type Annotation = BoxAnnotation | PenAnnotation | ArrowAnnotation | TextAnnotation;
export type AnnotationTool = "select" | "highlight" | "pen" | "rectangle" | "ellipse" | "arrow" | "text" | "eraser";

export type NoteKind = "week" | "page" | "transcript" | "annotation";
export interface Note {
  id: string;
  courseId?: string;
  weekId?: string;
  kind: NoteKind;
  content: string;
  pdfPage?: number;
  transcriptStartMs?: number;
  annotationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptWord {
  index: number;
  text: string;
  startMs: number;
  endMs: number;
  raw: RawTranscriptWord;
}

export interface TranscriptSegment {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  rawText?: string;
  correctedText?: string;
  words: TranscriptWord[];
}

export interface ReaderMaterials {
  pdf: Uint8Array;
  translationText: string | null;
  transcriptText: string | null;
  transcriptJson: string | null;
  progress: ReadingProgress;
}

export interface PageTranscriptAlignment {
  pageNumber: number;
  transcriptStartMs: number;
  transcriptEndMs: number;
  confidence: number;
  method: "automatic" | "manual";
}

export type InsightType = "teacher_emphasis" | "lecture_only" | "exam_info" | "confusion" | "example" | "definition" | "summary";
export interface LectureInsight {
  id: string;
  courseId: string;
  weekId: string;
  type: InsightType;
  title: string;
  summary: string;
  importance: number;
  confidence: number;
  pageNumbers: number[];
  transcriptStartMs?: number;
  transcriptEndMs?: number;
  evidence: string[];
  sourceType: "explicit" | "ai_inference";
  createdAt: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  lastCourseId: null,
  lastWeekId: null,
  layout: "bilingual",
  annotationTool: "select",
  annotationColor: "#f2c94c",
  annotationStrokeWidth: 2,
  aiProvider: "openrouter",
  aiModel: "openrouter/free",
  aiBaseUrl: "https://openrouter.ai/api/v1",
  aiConsentAccepted: false,
  aiConcurrency: 4,
  aiRouting: "throughput",
};
