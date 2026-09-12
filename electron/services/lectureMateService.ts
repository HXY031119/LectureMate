import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, extname, join, resolve, sep } from "node:path";
import type Database from "better-sqlite3";
import type { AIAnalysisProgress, AISettings, AiAnalysisJob, Annotation, AppSettings, Course, CourseTree, LectureAsset, LectureAssetKind, LectureMaterials, LectureSession, Note, PdfPageContent, ReaderMaterials, ReadingProgress, StoredWeekStudyNotes, TranscriptTranslationChunk, TranslationStatus, Week, WeekFile, WeekFileKind, WeekStudyNotes } from "../../shared/domain";
import type { CourseInput, NoteInput } from "../../shared/contracts";
import { isAnnotation } from "../../shared/annotations";
import { CourseRepository } from "../repositories/courseRepository";
import { WeekRepository } from "../repositories/weekRepository";
import { SettingsRepository } from "../repositories/settingsRepository";
import { ReadingProgressRepository } from "../repositories/readingProgressRepository";
import { AnnotationRepository } from "../repositories/annotationRepository";
import { NoteRepository } from "../repositories/noteRepository";
import { AIRepository } from "../repositories/aiRepository";
import { LectureRepository } from "../repositories/lectureRepository";
import { chunkPdfPages, chunkTranscript, chunkTranscriptForAnalysis, sha256, validateWeekStudyNotes } from "../ai/core";
import { isInvalidTranslation, OpenRouterProvider } from "../ai/provider";
import { ensureMapEvidence, mapWithConcurrency, mergeMapAnalyses, restoreStudyNoteEvidence, scoreTeacherEmphasis, validateMapAnalysis, type MapAnalysis } from "../ai/pipeline";

const managedNames: Record<WeekFileKind, string> = { pdf: "original.pdf", translation: "translation.txt", transcript_txt: "transcript.txt", transcript_json: "transcript.json" };

export class LectureMateService {
  readonly courses: CourseRepository;
  readonly weeks: WeekRepository;
  readonly settings: SettingsRepository;
  readonly readingProgress: ReadingProgressRepository;
  readonly annotations: AnnotationRepository;
  readonly notes: NoteRepository;
  readonly ai: AIRepository;
  readonly lectures: LectureRepository;
  private readonly analysisControllers = new Map<string, AbortController>();
  private readonly analysisJobs = new Map<string, AiAnalysisJob>();
  constructor(private readonly db: Database.Database, private readonly coursesRoot: string, readonly dataRoot: string, private readonly secrets?: { encrypt(value: string): string; decrypt(value: string): string }) {
    this.courses = new CourseRepository(db);
    this.weeks = new WeekRepository(db);
    this.settings = new SettingsRepository(db);
    this.readingProgress = new ReadingProgressRepository(db);
    this.annotations = new AnnotationRepository(db);
    this.notes = new NoteRepository(db);
    this.ai = new AIRepository(db);
    this.lectures = new LectureRepository(db);
  }
  getTree(): CourseTree[] {
    const weeks = this.weeks.list();
    const files = this.weeks.listFiles();
    return this.courses.list().map((course) => ({ ...course, weeks: weeks.filter((w) => w.courseId === course.id).map((week) => ({ ...week, files: files.filter((f) => f.weekId === week.id) })) }));
  }
  createCourse(input: CourseInput): Course { this.validateCourse(input); return this.courses.create(randomUUID(), this.cleanCourse(input), new Date().toISOString()); }
  updateCourse(id: string, input: CourseInput): Course {
    this.validateCourse(input); const course = this.courses.update(id, this.cleanCourse(input), new Date().toISOString());
    if (!course) throw new Error("找不到该课程"); return course;
  }
  deleteCourse(id: string): void {
    if (!this.courses.find(id)) throw new Error("找不到该课程");
    this.db.transaction(() => { this.courses.delete(id); this.repairSelection(); })();
    this.removeManaged(join(this.coursesRoot, id));
  }
  createWeek(courseId: string, requestedName?: string): Week {
    if (!this.courses.find(courseId)) throw new Error("找不到该课程");
    const position = this.weeks.nextPosition(courseId);
    const name = requestedName?.trim() || `第 ${position} 周`;
    return this.weeks.create(randomUUID(), courseId, name, position, new Date().toISOString());
  }
  updateWeek(id: string, name: string): Week {
    if (!name.trim()) throw new Error("周次名称不能为空");
    const week = this.weeks.update(id, name.trim(), new Date().toISOString());
    if (!week) throw new Error("找不到该周次"); return week;
  }
  deleteWeek(id: string): void {
    const week = this.weeks.find(id); if (!week) throw new Error("找不到该周次");
    this.db.transaction(() => { this.weeks.delete(id); this.repairSelection(); })();
    this.removeManaged(join(this.coursesRoot, week.courseId, week.id));
  }
  importFile(weekId: string, kind: WeekFileKind, sourcePath: string): WeekFile {
    const week = this.weeks.find(weekId); if (!week) throw new Error("找不到该周次");
    this.validateExtension(kind, sourcePath);
    const targetDir = join(this.coursesRoot, week.courseId, week.id); mkdirSync(targetDir, { recursive: true });
    const target = join(targetDir, managedNames[kind]); copyFileSync(sourcePath, target);
    const now = new Date().toISOString();
    const saved=this.weeks.upsertFile({ id: randomUUID(), weekId, kind, originalName: basename(sourcePath), managedPath: target, sha256: createHash("sha256").update(readFileSync(target)).digest("hex"), sizeBytes: statSync(target).size, createdAt: now, updatedAt: now });
    if(kind==="transcript_txt"||kind==="transcript_json"){const lecture=this.lectures.list(weekId)[0]??this.createLectureSession(weekId,"Lecture 1");this.lectures.saveAsset({id:randomUUID(),weekId,kind:kind==="transcript_txt"?"transcript_txt":"timestamp_json",originalName:saved.originalName,managedPath:saved.managedPath,sha256:saved.sha256,sizeBytes:saved.sizeBytes,createdAt:now,updatedAt:now},lecture.id);}
    return saved;
  }
  listLectureSessions(weekId: string): LectureSession[] { if (!this.weeks.find(weekId)) throw new Error("找不到该周次"); return this.lectures.list(weekId); }
  createLectureSession(weekId: string, requestedTitle?: string): LectureSession { if (!this.weeks.find(weekId)) throw new Error("找不到该周次"); const order=this.lectures.list(weekId).length+1; const title=requestedTitle?.trim() || `Lecture ${order}`; return this.lectures.create(randomUUID(),weekId,title,order,new Date().toISOString()); }
  updateLectureSession(id:string,title:string): LectureSession { if(!title.trim()) throw new Error("Lecture 名称不能为空"); const value=this.lectures.updateTitle(id,title.trim(),new Date().toISOString()); if(!value) throw new Error("找不到该 Lecture"); return value; }
  moveLectureSession(id:string,direction:"up"|"down"): LectureSession[] { return this.lectures.move(id,direction,new Date().toISOString()); }
  deleteLectureSession(id:string): void { const lecture=this.lectures.find(id); if(!lecture) throw new Error("找不到该 Lecture"); if(!this.lectures.delete(id)) throw new Error("无法删除该 Lecture"); this.removeManaged(join(this.coursesRoot,this.weeks.find(lecture.weekId)!.courseId,lecture.weekId,"lectures",id)); }
  importLectureAsset(lectureSessionId:string,kind:LectureAssetKind,sourcePath:string): LectureAsset { const lecture=this.lectures.find(lectureSessionId); if(!lecture) throw new Error("找不到该 Lecture"); this.validateExtension(kind==="timestamp_json"?"transcript_json":"transcript_txt",sourcePath); const week=this.weeks.find(lecture.weekId)!; const targetDir=join(this.coursesRoot,week.courseId,week.id,"lectures",lecture.id); mkdirSync(targetDir,{recursive:true}); const target=join(targetDir,kind==="transcript_txt"?"transcript.txt":"timestamps.json"); copyFileSync(sourcePath,target); const now=new Date().toISOString(); return this.lectures.saveAsset({id:randomUUID(),weekId:week.id,kind,originalName:basename(sourcePath),managedPath:target,sha256:createHash("sha256").update(readFileSync(target)).digest("hex"),sizeBytes:statSync(target).size,createdAt:now,updatedAt:now},lecture.id); }
  getLectureMaterials(lectureSessionId:string): LectureMaterials { const lecture=this.lectures.find(lectureSessionId); if(!lecture) throw new Error("找不到该 Lecture"); const decode=(asset:LectureAsset|null,label:string)=>{ if(!asset) return null; this.assertManagedFile(asset.managedPath); if(!existsSync(asset.managedPath)) throw new Error(`${label} 已从本地存储中删除，请重新导入`); try{return new TextDecoder("utf-8",{fatal:true}).decode(readFileSync(asset.managedPath));}catch{throw new Error(`${label} 不是有效的 UTF-8 文本`);} }; return {lecture,transcriptText:decode(lecture.transcriptAsset,"课堂字幕"),transcriptJson:decode(lecture.timestampAsset,"字幕时间数据")}; }
  updateSettings(update: Partial<AppSettings>): AppSettings {
    const settings = { ...this.settings.get(), ...update };
    if (!(["light", "dark", "system"] as const).includes(settings.theme)) throw new Error("无效的外观主题");
    return this.settings.set(settings);
  }
  getReaderMaterials(weekId: string): ReaderMaterials {
    if (!this.weeks.find(weekId)) throw new Error("找不到该周次");
    const files = this.weeks.listFiles(weekId);
    const pdf = files.find((file) => file.kind === "pdf");
    if (!pdf) throw new Error("本周尚未导入 PDF，无法开始阅读");
    const read = (kind: WeekFileKind): Buffer | null => {
      const file = files.find((item) => item.kind === kind);
      if (!file) return null;
      this.assertManagedFile(file.managedPath);
      if (!existsSync(file.managedPath)) throw new Error(`${file.originalName} 已从本地存储中删除，请返回周次页面重新导入`);
      return readFileSync(file.managedPath);
    };
    const decode = (kind: WeekFileKind, label: string): string | null => {
      const bytes = read(kind); if (!bytes) return null;
      try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { throw new Error(`${label} 不是有效的 UTF-8 文本，请检查文件编码`); }
    };
    const pdfBytes = read("pdf");
    if (!pdfBytes) throw new Error("PDF 文件不存在，请重新导入");
    return { pdf: new Uint8Array(pdfBytes), translationText: decode("translation", "中文翻译"), transcriptText: decode("transcript_txt", "课堂字幕"), transcriptJson: decode("transcript_json", "字幕时间数据"), progress: this.readingProgress.get(weekId) };
  }
  updateReadingProgress(progress: ReadingProgress): ReadingProgress {
    if (!this.weeks.find(progress.weekId)) throw new Error("找不到该周次");
    if (!Number.isInteger(progress.pageNumber) || progress.pageNumber < 1 || !Number.isFinite(progress.zoom) || progress.zoom < 0.25 || progress.zoom > 5) throw new Error("阅读进度数据无效");
    return this.readingProgress.set(progress);
  }
  listAnnotations(weekId: string, pageNumber: number): Annotation[] {
    if (!this.weeks.find(weekId) || !Number.isInteger(pageNumber) || pageNumber < 1) throw new Error("标注查询参数无效");
    return this.annotations.list(weekId, pageNumber);
  }
  saveAnnotation(annotation: Annotation): Annotation {
    if (!isAnnotation(annotation) || !this.weeks.find(annotation.weekId)) throw new Error("标注数据无效");
    return this.annotations.save({ ...annotation, updatedAt: new Date().toISOString() });
  }
  deleteAnnotation(id: string): void { if (!this.annotations.delete(id)) throw new Error("找不到该标注"); }
  listNotes(weekId: string): Note[] { if (!this.weeks.find(weekId)) throw new Error("找不到该周次"); return this.notes.list(weekId); }
  saveNote(input: NoteInput): Note {
    if (!input.weekId || !this.weeks.find(input.weekId)) throw new Error("笔记必须关联一个有效周次");
    if (!input.content.trim()) throw new Error("笔记内容不能为空");
    if (!['week', 'page', 'transcript', 'annotation'].includes(input.kind)) throw new Error("笔记类型无效");
    if (input.kind === "page" && (!Number.isInteger(input.pdfPage) || input.pdfPage! < 1)) throw new Error("页面笔记必须关联有效 PDF 页码");
    if (input.kind === "transcript" && (!Number.isInteger(input.transcriptStartMs) || input.transcriptStartMs! < 0)) throw new Error("字幕笔记必须关联有效字幕时间");
    if (input.kind === "annotation") {
      if (!input.annotationId) throw new Error("标注笔记必须先选择一个标注");
      const annotation = this.db.prepare("SELECT week_id FROM annotations WHERE id=?").get(input.annotationId) as { week_id: string } | undefined;
      if (!annotation || annotation.week_id !== input.weekId) throw new Error("标注笔记关联的标注无效");
    }
    const week = this.weeks.find(input.weekId)!; const now = new Date().toISOString(); const existing = input.id ? this.notes.find(input.id) : undefined;
    if (input.id && !existing) throw new Error("找不到该笔记");
    const note: Note = { id: input.id ?? randomUUID(), courseId: input.courseId ?? week.courseId, weekId: input.weekId, kind: input.kind, content: input.content.trim(), pdfPage: input.pdfPage, transcriptStartMs: input.transcriptStartMs, annotationId: input.annotationId, createdAt: existing?.createdAt ?? now, updatedAt: now };
    return this.notes.save(note);
  }
  deleteNote(id: string): void { if (!this.notes.delete(id)) throw new Error("找不到该笔记"); }
  getAISettings(): AISettings { const value = this.settings.get(); return { provider: value.aiProvider, model: value.aiModel, baseUrl: value.aiBaseUrl, hasApiKey: Boolean(this.ai.getEncryptedKey()), consentAccepted: value.aiConsentAccepted, concurrency: value.aiConcurrency, routing: value.aiRouting }; }
  updateAISettings(input: { provider: "openrouter"; model: string; baseUrl: string; apiKey?: string; consentAccepted?: boolean; concurrency?: number; routing?: "default" | "latency" | "throughput" }): AISettings {
    if (input.provider !== "openrouter") throw new Error("当前版本仅支持 OpenRouter"); if (!input.model.trim()) throw new Error("模型 ID 不能为空");
    let parsed: URL; try { parsed = new URL(input.baseUrl); } catch { throw new Error("Base URL 格式无效"); } if (parsed.protocol !== "https:") throw new Error("Base URL 必须使用 HTTPS");
    if (input.apiKey?.trim()) { if (!this.secrets) throw new Error("当前系统无法使用安全存储，API Key 未保存"); this.ai.setEncryptedKey(this.secrets.encrypt(input.apiKey.trim())); }
    const concurrency = input.concurrency ?? this.settings.get().aiConcurrency; if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 6) throw new Error("AI 并发数必须为 1–6"); const routing = input.routing ?? this.settings.get().aiRouting; if (!["default","latency","throughput"].includes(routing)) throw new Error("AI 路由设置无效");
    this.updateSettings({ aiProvider: input.provider, aiModel: input.model.trim(), aiBaseUrl: input.baseUrl.replace(/\/$/, ""), aiConcurrency: concurrency, aiRouting: routing, ...(input.consentAccepted !== undefined ? { aiConsentAccepted: input.consentAccepted } : {}) }); return this.getAISettings();
  }
  private provider(): OpenRouterProvider { const settings = this.settings.get(); const encrypted = this.ai.getEncryptedKey(); if (!encrypted) throw new Error("请先在设置中填写 OpenRouter API Key"); if (!this.secrets) throw new Error("安全存储不可用，无法读取 API Key"); return new OpenRouterProvider(this.secrets.decrypt(encrypted), settings.aiModel, settings.aiBaseUrl, settings.aiRouting); }
  async testAIConnection(input?: { provider: "openrouter"; model: string; baseUrl: string; apiKey?: string }): Promise<void> { if (input) this.updateAISettings(input); await this.provider().testConnection(); }
  private transcript(lectureSessionId: string): { text: string; chunks: ReturnType<typeof chunkTranscript>; lecture:LectureSession } { const lecture=this.lectures.find(lectureSessionId)??this.lectures.list(lectureSessionId)[0]; if(!lecture?.transcriptAsset) throw new Error("该 Lecture 尚未导入课堂字幕 TXT"); this.assertManagedFile(lecture.transcriptAsset.managedPath); const text=readFileSync(lecture.transcriptAsset.managedPath,"utf8"); return {text,chunks:chunkTranscript(lecture.weekId,text,3500,lecture.id,lecture.title),lecture}; }
  getTranslationStatus(lectureSessionId: string): TranslationStatus { const { text, chunks,lecture } = this.transcript(lectureSessionId); const saved=this.ai.listTranslations(lecture.id);const invalid=saved.filter(item=>isInvalidTranslation(item.translatedText));invalid.forEach(item=>this.ai.deleteTranslation(item.id));const all=saved.filter(item=>!isInvalidTranslation(item.translatedText)); const cached = all.filter((item) => chunks.some((chunk) => chunk.orderIndex === item.orderIndex && chunk.sourceHash === item.sourceHash)); return { sourceChunks: chunks, chunks: cached, total: chunks.length, sourceHash: sha256(text), stale: all.some((item) => !chunks.some((chunk) => chunk.orderIndex === item.orderIndex && chunk.sourceHash === item.sourceHash)) }; }
  async translateTranscriptChunk(lectureSessionId: string, orderIndex: number): Promise<TranscriptTranslationChunk> { const { chunks,lecture } = this.transcript(lectureSessionId); const chunk = chunks[orderIndex]; if (!chunk) throw new Error("字幕分块不存在"); const cached = this.ai.listTranslations(lecture.id).find((v) => v.orderIndex === orderIndex && v.sourceHash === chunk.sourceHash&&!isInvalidTranslation(v.translatedText)); if (cached) return cached; const previousTail = orderIndex ? chunks[orderIndex - 1].sourceText.slice(-500) : undefined; const result = await this.provider().translate({ text: chunk.sourceText, previousTail }); const settings = this.settings.get(); const now = new Date().toISOString(); return this.ai.saveTranslation({ ...chunk, translatedText: result.translatedText, provider: settings.aiProvider, model: settings.aiModel, createdAt: now, updatedAt: now }); }
  getStudyNotes(weekId: string): StoredWeekStudyNotes | null { const stored=this.ai.getStudyNotes(weekId);if(!stored)return null;const cached=this.ai.listMapResults(weekId).map(row=>{const value=validateMapAnalysis(row.result,row.stage);return ensureMapEvidence(value,{stage:row.stage,sourceText:Object.values(value).flat().map(f=>`${f.title}: ${f.summary}`).join("\n"),lectureSessionId:row.lectureSessionId,lectureTitle:row.lectureTitle});});if(!cached.length)return stored;const merged=mergeMapAnalyses(cached);const generatedContent=restoreStudyNoteEvidence(stored.generatedContent,merged);const editedContent=stored.editedContent?restoreStudyNoteEvidence(stored.editedContent,merged):null;const repaired={...stored,generatedContent,editedContent};const before=JSON.stringify([stored.generatedContent,stored.editedContent]),after=JSON.stringify([generatedContent,editedContent]);return before===after?stored:this.ai.saveStudyNotes({...repaired,updatedAt:new Date().toISOString()}); }
  private studySourceHash(weekId: string, pdfPages: PdfPageContent[]): string { const lectures=this.lectures.list(weekId); const annotations=this.db.prepare("SELECT id,updated_at FROM annotations WHERE week_id=? ORDER BY id").all(weekId); const notes=this.db.prepare("SELECT id,updated_at FROM notes WHERE week_id=? ORDER BY id").all(weekId); return sha256(JSON.stringify({ analysisVersion:"transcript-first-v2",pdf: pdfPages.map((page) => [page.pageNumber, sha256(page.text)]), transcripts:lectures.map(l=>[l.id,l.transcriptAsset?.sha256??null]),annotations,notes })); }
  cancelStudyNotes(weekId: string): void { this.analysisControllers.get(weekId)?.abort(); }
  listAIAnalysisJobs(): AiAnalysisJob[] { return [...this.analysisJobs.values()]; }
  startStudyNotesJob(weekId:string,pdfPages:PdfPageContent[],force=false,notify?:(job:AiAnalysisJob)=>void):AiAnalysisJob {
    const active=this.analysisJobs.get(weekId); if(active&&["queued","running"].includes(active.status))return active;
    const now=new Date().toISOString(); const job:AiAnalysisJob={id:randomUUID(),weekId,status:"queued",startedAt:now,progress:{weekId,completed:0,total:1,pdfCompleted:0,pdfTotal:0,transcriptCompleted:0,transcriptTotal:0,cacheHits:0,requests:0,stage:"preparing",message:"正在准备 AI 分析"}}; this.analysisJobs.set(weekId,job); notify?.(job);
    void this.generateStudyNotes(weekId,pdfPages,force,(progress)=>{job.status=progress.stage==="cancelled"?"cancelled":"running";job.progress=progress;notify?.({...job});}).then(()=>{job.status="completed";job.completedAt=new Date().toISOString();notify?.({...job});}).catch(error=>{job.status=job.progress.stage==="cancelled"?"cancelled":"failed";job.error=error instanceof Error?error.message:String(error);job.completedAt=new Date().toISOString();notify?.({...job});});
    return job;
  }
  async generateStudyNotes(weekId: string, pdfPages: PdfPageContent[], force = false, progress?: (value: AIAnalysisProgress) => void): Promise<StoredWeekStudyNotes> {
    if (!this.weeks.find(weekId)) throw new Error("找不到该周次"); if (!pdfPages.length) throw new Error("PDF 没有可分析的英文文本"); this.cancelStudyNotes(weekId); const controller = new AbortController(); this.analysisControllers.set(weekId, controller);
    const started = Date.now(); const settings = this.settings.get(); const sourceHash = this.studySourceHash(weekId, pdfPages); const existing = this.ai.getStudyNotes(weekId); const pdfChunks = chunkPdfPages(pdfPages, 12_000); const lectureSessions=this.lectures.list(weekId); const transcriptChunks=lectureSessions.flatMap((lecture)=>lecture.transcriptAsset ? chunkTranscriptForAnalysis(weekId,readFileSync(lecture.transcriptAsset.managedPath,"utf8"),12_000,lecture.id,lecture.title) : []); const total = pdfChunks.length + transcriptChunks.length + 1;
    const state = { weekId, completed: 0, total, pdfCompleted: 0, pdfTotal: pdfChunks.length, transcriptCompleted: 0, transcriptTotal: transcriptChunks.length, cacheHits: 0, requests: 0 };
    const emit = (stage: AIAnalysisProgress["stage"], message: string) => progress?.({ ...state, stage, message }); emit("preparing", `准备 ${pdfChunks.length} 个 PDF 块和 ${transcriptChunks.length} 个字幕块`);
    if (!force && existing?.sourceHash === sourceHash) { state.completed = total; state.cacheHits = pdfChunks.length + transcriptChunks.length; emit("complete", "资料未变化，已读取最终笔记缓存"); return existing; }
    const provider = this.provider(); const pdfTasks = pdfChunks.map((pages, orderIndex) => ({ stage: "pdf" as const, orderIndex, sourceText: pages.map((page) => `[PDF page ${page.pageNumber}]\n${page.text}`).join("\n"), sourceHash: sha256(`transcript-first-v2:${JSON.stringify(pages)}`), lectureSessionId:undefined, lectureTitle:undefined })); const transcriptTasks = transcriptChunks.map((chunk) => ({ stage: "transcript" as const, orderIndex: chunk.orderIndex, sourceText: `[${chunk.lectureTitle}]\n${chunk.sourceText}`, sourceHash: sha256(`transcript-first-v2:${chunk.lectureSessionId}:${chunk.sourceHash}`), lectureSessionId:chunk.lectureSessionId, lectureTitle:chunk.lectureTitle })); const tasks = Array.from({ length: Math.max(pdfTasks.length, transcriptTasks.length) }, (_, index) => [pdfTasks[index], transcriptTasks[index]]).flat().filter((task): task is NonNullable<typeof task> => Boolean(task));
    const mapStarted = Date.now(); const requestTimes: number[] = [];
    try {
      const mapped = await mapWithConcurrency(tasks, settings.aiConcurrency, async (task) => {
        if (controller.signal.aborted) throw new DOMException("用户取消", "AbortError"); const cached = this.ai.getMapResult(weekId, task.stage, task.sourceHash, settings.aiProvider, settings.aiModel); let value: MapAnalysis;
        if (cached) { value = validateMapAnalysis(cached, task.stage); state.cacheHits++; }
        else { const requestStarted = Date.now(); state.requests++; const sourceRules=task.stage==="pdf"?`This is PDF context only. Extract concepts and formulas. teacherEmphasis and assessmentInfo MUST be empty: slide prominence, headings, detail, and formulas are never evidence of what the teacher emphasized or said about assessment.`:`This is the primary source for teacher emphasis and assessment facts. For every teacherEmphasis item output concept/title, explanationSummary/summary, explicitEmphasis (0-3), repeatedMentions (0-3), explanationDepth (0-3), examples, comparisons, warnings, assessmentMentions, and verbatim transcriptEvidence/evidence. Detect explicit emphasis language, repetition, time/depth, examples, contrasts, warnings, and exam/quiz signals. Do not infer assessment facts not spoken here.`; const raw = await provider.generateStructured<unknown>({ signal: controller.signal, system: `You extract terse facts from one English ${task.stage === "pdf" ? "PDF" : "lecture transcript"} chunk. ${sourceRules} Return JSON only with arrays: concepts, teacherEmphasis, lectureAdditions, assessmentInfo, formulas. Evidence must quote this source. Every formula item contains name, expression, meaning, variables, pageNumber, context, confidence. Do not invent.`, prompt: task.sourceText }); const durationMs = Date.now() - requestStarted; requestTimes.push(durationMs); value = validateMapAnalysis(raw, task.stage); if(task.stage==="pdf")value={...value,teacherEmphasis:[],assessmentInfo:[]}; this.ai.saveMapResult({ id: randomUUID(), weekId, stage: task.stage, orderIndex: task.orderIndex, sourceHash: task.sourceHash, provider: settings.aiProvider, model: settings.aiModel, result: value, durationMs,lectureSessionId:task.lectureSessionId,lectureTitle:task.lectureTitle }); if (process.env.VITE_DEV_SERVER_URL) console.info(`[AI perf] map stage=${task.stage} chunk=${task.orderIndex} durationMs=${durationMs}`); }
        if(task.stage==="pdf")value={...value,teacherEmphasis:[],assessmentInfo:[]}; value=ensureMapEvidence(value,task);if(task.lectureSessionId) value={...value,...Object.fromEntries(Object.entries(value).map(([key,list])=>[key,(list as import("../ai/pipeline").MapFact[]).map(item=>({...item,evidence:item.evidence.map(e=>({...e,lectureSessionId:task.lectureSessionId,lectureTitle:task.lectureTitle}))}))]))} as MapAnalysis;
        state.completed++; if (task.stage === "pdf") state.pdfCompleted++; else state.transcriptCompleted++; emit(task.stage, task.stage === "pdf" ? `PDF 分析 ${state.pdfCompleted}/${state.pdfTotal}` : `字幕分析 ${state.transcriptCompleted}/${state.transcriptTotal}`); return value;
      }, () => controller.signal.aborted);
      const mapMs = Date.now() - mapStarted; emit("merging", "正在整合重点..."); const merged = mergeMapAnalyses(mapped); const annotationFacts=this.db.prepare("SELECT page_number pageNumber,type,payload_json payload FROM annotations WHERE week_id=?").all(weekId); const noteFacts=this.notes.list(weekId).map(n=>({kind:n.kind,content:n.content,pdfPage:n.pdfPage,transcriptStartMs:n.transcriptStartMs})); const reduceStarted = Date.now(); emit("generating", "正在生成最终中文学习笔记..."); state.requests++; const schema = `输出中文 JSON：coreConcepts,teacherEmphasis,lectureAdditions,confusingConcepts,examples,assessmentInfo,formulasAndDefinitions,reviewPriorities 均为数组，条目含 title,summary,evidence；finalSummary 为字符串。Core Concepts 表示 PDF 知识结构；Teacher Emphasis 只可来自 map.teacherEmphasis 的 Transcript 证据，必须合并跨 Lecture 同一概念，不能因 PDF 标题、篇幅或公式提高；Assessment Info 只可陈述 Transcript 明说的事实。User notes/annotations 只能影响 reviewPriorities，不得影响老师重点。保留全部有效公式，仅对同一表达式去重。`;
      const finalRaw = await provider.generateStructured<unknown>({ signal: controller.signal, maxTokens: 5000, timeoutMs: 180_000, system: `你把课程 Map 事实合并成中文 Week 学习笔记。证据优先级：Transcript 明确证据 > Transcript 重复/讲解深度 > assessment signal > PDF 背景。${schema}`, prompt: JSON.stringify({map:merged,annotations:annotationFacts,notes:noteFacts}) }); const generatedContent = restoreStudyNoteEvidence(validateWeekStudyNotes(finalRaw, weekId),merged); const emphasisByTitle=new Map(merged.teacherEmphasis.map(f=>[f.title.toLocaleLowerCase(),f])); generatedContent.teacherEmphasis=generatedContent.teacherEmphasis.flatMap(item=>{const fact=emphasisByTitle.get(item.title.toLocaleLowerCase())??merged.teacherEmphasis.find(f=>f.title.toLocaleLowerCase().includes(item.title.toLocaleLowerCase())||item.title.toLocaleLowerCase().includes(f.title.toLocaleLowerCase()));if(!fact)return[];const evidence=fact.evidence.filter(e=>e.source==="transcript");if(!evidence.length)return[];const scored=scoreTeacherEmphasis({...fact,evidence});return[{...item,evidence,importance:scored.importance,reasons:scored.reasons,emphasisType:fact.teacherSignals?.explicitEmphasis?"explicit":"inferred" as const}];}).sort((a,b)=>(b.importance??0)-(a.importance??0)); generatedContent.assessmentInfo=generatedContent.assessmentInfo.map(item=>({...item,evidence:item.evidence.filter(e=>e.source==="transcript")})).filter(item=>item.evidence.length); state.completed++; const reduceMs = Date.now() - reduceStarted; const now = new Date().toISOString(); const saved = this.ai.saveStudyNotes({ id: existing?.id ?? randomUUID(), weekId, provider: settings.aiProvider, model: settings.aiModel, sourceHash, status: "complete", generatedContent, editedContent: null, createdAt: existing?.createdAt ?? now, updatedAt: now }); emit("complete", "AI 学习笔记生成完成"); if (process.env.VITE_DEV_SERVER_URL) console.info(`[AI perf] week=${weekId} chunks=${tasks.length} cacheHits=${state.cacheHits} apiRequests=${state.requests} requestMs=[${requestTimes.join(",")}] mapMs=${mapMs} reduceMs=${reduceMs} totalMs=${Date.now() - started}`); return saved;
    } catch (error) { if (controller.signal.aborted) { emit("cancelled", "已取消；成功的分块结果已缓存"); throw new Error("用户已取消分析；已完成的分块会在下次继续使用"); } throw error; }
    finally { if (this.analysisControllers.get(weekId) === controller) this.analysisControllers.delete(weekId); }
  }
  saveEditedStudyNotes(weekId: string, content: WeekStudyNotes): StoredWeekStudyNotes { const existing = this.ai.getStudyNotes(weekId); if (!existing) throw new Error("尚未生成 AI 学习笔记"); const editedContent = validateWeekStudyNotes(content, weekId); return this.ai.saveStudyNotes({ ...existing, editedContent, updatedAt: new Date().toISOString() }); }
  deleteStudyNotes(weekId: string): void { if (!this.weeks.find(weekId)) throw new Error("找不到该周次"); this.db.transaction(() => { this.ai.deleteStudyNotes(weekId); this.db.prepare("DELETE FROM ai_analysis_runs WHERE week_id=?").run(weekId); this.db.prepare("DELETE FROM ai_map_cache WHERE week_id=?").run(weekId); })(); }
  private validateCourse(input: CourseInput): void { if (!input.name.trim()) throw new Error("课程名称不能为空"); if (!/^#[0-9a-f]{6}$/i.test(input.color)) throw new Error("无效的课程颜色"); }
  private cleanCourse(input: CourseInput): CourseInput { return { code: input.code.trim(), name: input.name.trim(), color: input.color, icon: input.icon.trim() || "BookOpen" }; }
  private validateExtension(kind: WeekFileKind, path: string): void { const expected = kind === "pdf" ? ".pdf" : kind === "transcript_json" ? ".json" : ".txt"; if (extname(path).toLowerCase() !== expected) throw new Error(`请选择 ${expected} 格式的文件`); }
  private repairSelection(): void { const current = this.settings.get(); const courseOk = current.lastCourseId && this.courses.find(current.lastCourseId); const weekOk = current.lastWeekId && this.weeks.find(current.lastWeekId); if (!courseOk || !weekOk) this.settings.set({ ...current, lastCourseId: null, lastWeekId: null }); }
  private removeManaged(path: string): void { const root = resolve(this.coursesRoot) + sep; const target = resolve(path); if (!target.startsWith(root)) throw new Error("为保护本地数据，无法删除应用管理目录以外的文件"); rmSync(target, { recursive: true, force: true }); }
  private assertManagedFile(path: string): void { const root = resolve(this.coursesRoot) + sep; if (!resolve(path).startsWith(root)) throw new Error("文件路径不在 LectureMate 管理目录中"); }
}
