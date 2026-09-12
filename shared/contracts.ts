import type { AIAnalysisProgress, AISettings, AiAnalysisJob, Annotation, AppSettings, Course, CourseTree, LectureAsset, LectureAssetKind, LectureMaterials, LectureSession, Note, NoteKind, ReaderMaterials, ReadingProgress, StoredWeekStudyNotes, TranscriptTranslationChunk, TranslationStatus, Week, WeekFile, WeekFileKind, WeekStudyNotes } from "./domain";

export interface AppError {
  code: string;
  message: string;
}
export type AppResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

export interface CourseInput {
  code: string;
  name: string;
  color: string;
  icon: string;
}
export interface WeekInput { courseId: string; name?: string }
export interface UpdateWeekInput { id: string; name: string }
export interface ImportFileInput { weekId: string; kind: WeekFileKind }
export interface NoteInput { id?: string; courseId?: string; weekId?: string; kind: NoteKind; content: string; pdfPage?: number; transcriptStartMs?: number; annotationId?: string }
export interface AISettingsInput { provider: "openrouter"; model: string; baseUrl: string; apiKey?: string; consentAccepted?: boolean; concurrency?: number; routing?: "default" | "latency" | "throughput" }
export interface TranslateChunkInput { lectureSessionId: string; orderIndex: number }
export interface LectureInput { weekId: string; title?: string }
export interface UpdateLectureInput { id: string; title: string }
export interface MoveLectureInput { id: string; direction: "up" | "down" }
export interface ImportLectureAssetInput { lectureSessionId: string; kind: LectureAssetKind }
export interface StudyNotesInput { weekId: string; pdfPages: import("./domain").PdfPageContent[]; force?: boolean }

export interface LectureMateApi {
  getCourseTree(): Promise<AppResult<CourseTree[]>>;
  createCourse(input: CourseInput): Promise<AppResult<Course>>;
  updateCourse(input: CourseInput & { id: string }): Promise<AppResult<Course>>;
  deleteCourse(id: string): Promise<AppResult<void>>;
  createWeek(input: WeekInput): Promise<AppResult<Week>>;
  updateWeek(input: UpdateWeekInput): Promise<AppResult<Week>>;
  deleteWeek(id: string): Promise<AppResult<void>>;
  importWeekFile(input: ImportFileInput): Promise<AppResult<WeekFile | null>>;
  getSettings(): Promise<AppResult<AppSettings>>;
  updateSettings(input: Partial<AppSettings>): Promise<AppResult<AppSettings>>;
  getDataDirectory(): Promise<AppResult<string>>;
  getReaderMaterials(weekId: string): Promise<AppResult<ReaderMaterials>>;
  listLectureSessions(weekId: string): Promise<AppResult<LectureSession[]>>;
  createLectureSession(input: LectureInput): Promise<AppResult<LectureSession>>;
  updateLectureSession(input: UpdateLectureInput): Promise<AppResult<LectureSession>>;
  moveLectureSession(input: MoveLectureInput): Promise<AppResult<LectureSession[]>>;
  deleteLectureSession(id: string): Promise<AppResult<void>>;
  importLectureAsset(input: ImportLectureAssetInput): Promise<AppResult<LectureAsset | null>>;
  getLectureMaterials(lectureSessionId: string): Promise<AppResult<LectureMaterials>>;
  updateReadingProgress(input: ReadingProgress): Promise<AppResult<ReadingProgress>>;
  listAnnotations(weekId: string, pageNumber: number): Promise<AppResult<Annotation[]>>;
  saveAnnotation(annotation: Annotation): Promise<AppResult<Annotation>>;
  deleteAnnotation(id: string): Promise<AppResult<void>>;
  listNotes(weekId: string): Promise<AppResult<Note[]>>;
  saveNote(input: NoteInput): Promise<AppResult<Note>>;
  deleteNote(id: string): Promise<AppResult<void>>;
  getAISettings(): Promise<AppResult<AISettings>>;
  updateAISettings(input: AISettingsInput): Promise<AppResult<AISettings>>;
  testAIConnection(input?: AISettingsInput): Promise<AppResult<void>>;
  getTranslationStatus(lectureSessionId: string): Promise<AppResult<TranslationStatus>>;
  translateTranscriptChunk(input: TranslateChunkInput): Promise<AppResult<TranscriptTranslationChunk>>;
  getStudyNotes(weekId: string): Promise<AppResult<StoredWeekStudyNotes | null>>;
  generateStudyNotes(input: StudyNotesInput): Promise<AppResult<StoredWeekStudyNotes>>;
  startStudyNotesJob(input: StudyNotesInput): Promise<AppResult<AiAnalysisJob>>;
  listAIAnalysisJobs(): Promise<AppResult<AiAnalysisJob[]>>;
  onAIAnalysisJob(listener: (job: AiAnalysisJob) => void): () => void;
  onAIAnalysisProgress(listener: (progress: AIAnalysisProgress) => void): () => void;
  cancelStudyNotes(weekId: string): Promise<AppResult<void>>;
  saveEditedStudyNotes(weekId: string, content: WeekStudyNotes): Promise<AppResult<StoredWeekStudyNotes>>;
  deleteStudyNotes(weekId: string): Promise<AppResult<void>>;
}
