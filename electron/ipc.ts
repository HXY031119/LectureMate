import { BrowserWindow, dialog, ipcMain } from "electron";
import type { AISettingsInput, AppResult, CourseInput, ImportFileInput, ImportLectureAssetInput, LectureInput, MoveLectureInput, StudyNotesInput, TranslateChunkInput, UpdateLectureInput, UpdateWeekInput, WeekInput } from "../shared/contracts";
import type { Annotation, AppSettings, ReadingProgress, WeekFileKind } from "../shared/domain";
import type { NoteInput } from "../shared/contracts";
import type { LectureMateService } from "./services/lectureMateService";

export const CHANNELS = {
  tree: "lecturemate:tree", createCourse: "lecturemate:course:create", updateCourse: "lecturemate:course:update",
  deleteCourse: "lecturemate:course:delete", createWeek: "lecturemate:week:create", updateWeek: "lecturemate:week:update",
  deleteWeek: "lecturemate:week:delete", importFile: "lecturemate:file:import", getSettings: "lecturemate:settings:get",
  updateSettings: "lecturemate:settings:update", dataDirectory: "lecturemate:data-directory",
  readerMaterials: "lecturemate:reader:materials", readingProgress: "lecturemate:reader:progress",
  annotations: "lecturemate:annotations:list", saveAnnotation: "lecturemate:annotations:save", deleteAnnotation: "lecturemate:annotations:delete",
  notes: "lecturemate:notes:list", saveNote: "lecturemate:notes:save", deleteNote: "lecturemate:notes:delete",
  aiSettings: "lecturemate:ai:settings", updateAISettings: "lecturemate:ai:settings:update", testAI: "lecturemate:ai:test",
  translationStatus: "lecturemate:ai:translation:status", translateChunk: "lecturemate:ai:translation:chunk",
  studyNotes: "lecturemate:ai:study-notes", generateStudyNotes: "lecturemate:ai:study-notes:generate", editStudyNotes: "lecturemate:ai:study-notes:edit",
  deleteStudyNotes: "lecturemate:ai:study-notes:delete",
  cancelStudyNotes: "lecturemate:ai:study-notes:cancel",
  aiProgress: "lecturemate:ai:analysis:progress",
  aiJobs: "lecturemate:ai:analysis:jobs", startAIJob: "lecturemate:ai:analysis:start", aiJob: "lecturemate:ai:analysis:job",
  lectures: "lecturemate:lectures:list", createLecture:"lecturemate:lectures:create", updateLecture:"lecturemate:lectures:update", moveLecture:"lecturemate:lectures:move", deleteLecture:"lecturemate:lectures:delete", importLectureAsset:"lecturemate:lectures:asset:import", lectureMaterials:"lecturemate:lectures:materials",
} as const;

const wrap = async <T>(operation: () => T | Promise<T>): Promise<AppResult<T>> => {
  try { return { ok: true, value: await operation() }; }
  catch (error) { return { ok: false, error: { code: "OPERATION_FAILED", message: error instanceof Error ? error.message : "发生了意外错误" } }; }
};

export function registerIpc(service: LectureMateService): void {
  ipcMain.handle(CHANNELS.tree, () => wrap(() => service.getTree()));
  ipcMain.handle(CHANNELS.createCourse, (_event, input: CourseInput) => wrap(() => service.createCourse(input)));
  ipcMain.handle(CHANNELS.updateCourse, (_event, input: CourseInput & { id: string }) => wrap(() => service.updateCourse(input.id, input)));
  ipcMain.handle(CHANNELS.deleteCourse, (_event, id: string) => wrap(() => service.deleteCourse(id)));
  ipcMain.handle(CHANNELS.createWeek, (_event, input: WeekInput) => wrap(() => service.createWeek(input.courseId, input.name)));
  ipcMain.handle(CHANNELS.updateWeek, (_event, input: UpdateWeekInput) => wrap(() => service.updateWeek(input.id, input.name)));
  ipcMain.handle(CHANNELS.deleteWeek, (_event, id: string) => wrap(() => service.deleteWeek(id)));
  ipcMain.handle(CHANNELS.importFile, (_event, input: ImportFileInput) => wrap(async () => {
    const filters: Record<WeekFileKind, Electron.FileFilter> = {
      pdf: { name: "PDF 文件", extensions: ["pdf"] }, translation: { name: "文本文件", extensions: ["txt"] },
      transcript_txt: { name: "文本文件", extensions: ["txt"] }, transcript_json: { name: "JSON 文件", extensions: ["json"] },
    };
    const picked = await dialog.showOpenDialog({ title: "选择要导入的文件", buttonLabel: "导入", properties: ["openFile"], filters: [filters[input.kind]] });
    return picked.canceled ? null : service.importFile(input.weekId, input.kind, picked.filePaths[0]);
  }));
  ipcMain.handle(CHANNELS.getSettings, () => wrap(() => service.settings.get()));
  ipcMain.handle(CHANNELS.updateSettings, (_event, input: Partial<AppSettings>) => wrap(() => service.updateSettings(input)));
  ipcMain.handle(CHANNELS.dataDirectory, () => wrap(() => service.dataRoot));
  ipcMain.handle(CHANNELS.readerMaterials, (_event, weekId: string) => wrap(() => service.getReaderMaterials(weekId)));
  ipcMain.handle(CHANNELS.lectures,(_event,weekId:string)=>wrap(()=>service.listLectureSessions(weekId)));
  ipcMain.handle(CHANNELS.createLecture,(_event,input:LectureInput)=>wrap(()=>service.createLectureSession(input.weekId,input.title)));
  ipcMain.handle(CHANNELS.updateLecture,(_event,input:UpdateLectureInput)=>wrap(()=>service.updateLectureSession(input.id,input.title)));
  ipcMain.handle(CHANNELS.moveLecture,(_event,input:MoveLectureInput)=>wrap(()=>service.moveLectureSession(input.id,input.direction)));
  ipcMain.handle(CHANNELS.deleteLecture,(_event,id:string)=>wrap(()=>service.deleteLectureSession(id)));
  ipcMain.handle(CHANNELS.importLectureAsset,(_event,input:ImportLectureAssetInput)=>wrap(async()=>{ const picked=await dialog.showOpenDialog({title:input.kind==="transcript_txt"?"选择字幕 TXT":"选择时间戳 JSON",buttonLabel:"导入",properties:["openFile"],filters:[input.kind==="transcript_txt"?{name:"文本文件",extensions:["txt"]}:{name:"JSON 文件",extensions:["json"]}]}); return picked.canceled?null:service.importLectureAsset(input.lectureSessionId,input.kind,picked.filePaths[0]); }));
  ipcMain.handle(CHANNELS.lectureMaterials,(_event,id:string)=>wrap(()=>service.getLectureMaterials(id)));
  ipcMain.handle(CHANNELS.readingProgress, (_event, input: ReadingProgress) => wrap(() => service.updateReadingProgress(input)));
  ipcMain.handle(CHANNELS.annotations, (_event, weekId: string, pageNumber: number) => wrap(() => service.listAnnotations(weekId, pageNumber)));
  ipcMain.handle(CHANNELS.saveAnnotation, (_event, annotation: Annotation) => wrap(() => service.saveAnnotation(annotation)));
  ipcMain.handle(CHANNELS.deleteAnnotation, (_event, id: string) => wrap(() => service.deleteAnnotation(id)));
  ipcMain.handle(CHANNELS.notes, (_event, weekId: string) => wrap(() => service.listNotes(weekId)));
  ipcMain.handle(CHANNELS.saveNote, (_event, input: NoteInput) => wrap(() => service.saveNote(input)));
  ipcMain.handle(CHANNELS.deleteNote, (_event, id: string) => wrap(() => service.deleteNote(id)));
  ipcMain.handle(CHANNELS.aiSettings, () => wrap(() => service.getAISettings()));
  ipcMain.handle(CHANNELS.updateAISettings, (_event, input: AISettingsInput) => wrap(() => service.updateAISettings(input)));
  ipcMain.handle(CHANNELS.testAI, (_event, input?: AISettingsInput) => wrap(() => service.testAIConnection(input)));
  ipcMain.handle(CHANNELS.translationStatus, (_event, lectureSessionId: string) => wrap(() => service.getTranslationStatus(lectureSessionId)));
  ipcMain.handle(CHANNELS.translateChunk, (_event, input: TranslateChunkInput) => wrap(() => service.translateTranscriptChunk(input.lectureSessionId, input.orderIndex)));
  ipcMain.handle(CHANNELS.studyNotes, (_event, weekId: string) => wrap(() => service.getStudyNotes(weekId)));
  ipcMain.handle(CHANNELS.generateStudyNotes, (event, input: StudyNotesInput) => wrap(() => service.generateStudyNotes(input.weekId, input.pdfPages, input.force, (progress) => { if (!event.sender.isDestroyed()) event.sender.send(CHANNELS.aiProgress, progress); })));
  ipcMain.handle(CHANNELS.aiJobs, () => wrap(() => service.listAIAnalysisJobs()));
  ipcMain.handle(CHANNELS.startAIJob, (_event, input:StudyNotesInput) => wrap(() => service.startStudyNotesJob(input.weekId,input.pdfPages,input.force,(job)=>BrowserWindow.getAllWindows().forEach(window=>window.webContents.send(CHANNELS.aiJob,job)))));
  ipcMain.handle(CHANNELS.cancelStudyNotes, (_event, weekId: string) => wrap(() => service.cancelStudyNotes(weekId)));
  ipcMain.handle(CHANNELS.editStudyNotes, (_event, weekId: string, content) => wrap(() => service.saveEditedStudyNotes(weekId, content)));
  ipcMain.handle(CHANNELS.deleteStudyNotes, (_event, weekId: string) => wrap(() => service.deleteStudyNotes(weekId)));
}
