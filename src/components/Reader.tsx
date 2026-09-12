import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Brain, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, FileSearch, List, Minus, NotebookPen, PanelLeftClose, PanelLeftOpen, Plus, Search, Trash2, X } from "lucide-react";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { AIAnalysisProgress, LayoutMode, LectureSession, Note, PdfPageContent, ReaderMaterials, ReadingProgress, StoredWeekStudyNotes, TranscriptSegment, TranslationPage, TranslationStatus, WeekStudyNotes, WeekWithFiles } from "../../shared/domain";
import { parseTranslationPages } from "../lib/translationParser";
import { formatTranscriptTime, parseTranscriptJson, seekToTranscriptTime, segmentTranscript } from "../lib/transcript";
import { AnnotationLayer } from "./AnnotationLayer";

GlobalWorkerOptions.workerSrc = workerUrl;

interface ReaderProps { week: WeekWithFiles; courseLabel: string; onBack: () => void }
const layoutLabels: Record<LayoutMode, string> = { bilingual: "双语阅读", "pdf-focus": "PDF 专注", "lecture-review": "课堂复习" };

export function Reader({ week, courseLabel, onBack }: ReaderProps) {
  const [materials, setMaterials] = useState<ReaderMaterials | null>(null);
  const [progress, setProgress] = useState<ReadingProgress | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [translationPages, setTranslationPages] = useState<TranslationPage[]>([]);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [translationFont, setTranslationFont] = useState(17);
  const [transcriptFont, setTranscriptFont] = useState(14);
  const [translationPage, setTranslationPage] = useState(1);
  const [transcriptTranslation, setTranscriptTranslation] = useState<TranslationStatus | null>(null);
  const [lectures,setLectures]=useState<LectureSession[]>([]); const [selectedLectureId,setSelectedLectureId]=useState<string|null>(null);
  const [translatingSentence, setTranslatingSentence] = useState<number | null>(null); const [translationFailure, setTranslationFailure] = useState<string | null>(null);
  const [studyOpen, setStudyOpen] = useState(false); const [studyNotes, setStudyNotes] = useState<StoredWeekStudyNotes | null>(null); const [studyBusy, setStudyBusy] = useState(false); const [studyError, setStudyError] = useState<string | null>(null);
  const [myNotesOpen,setMyNotesOpen]=useState(false);
  const [studyProgress, setStudyProgress] = useState<AIAnalysisProgress | null>(null);
  const [studyProgressHidden,setStudyProgressHidden]=useState(false);
  const saveReady = useRef(false);

  useEffect(() => {
    let active = true;
    saveReady.current = false;
    setMaterials(null); setLoadError(null); setTranslationError(null); setTranscriptError(null);
    const api = window.lectureMate.getReaderMaterials;
    if (typeof api !== "function") {
      setLoadError("当前窗口仍在使用旧版桌面进程。请完全退出 LectureMate，再重新运行 npm run dev。");
      return () => { active = false; };
    }
    const timeout = window.setTimeout(() => {
      if (active) setLoadError("课程资料加载超时。请返回周次后重试；如果问题持续，请重启 LectureMate。");
    }, 15_000);
    void api(week.id).then(async (result) => {
      if (!active) return;
      window.clearTimeout(timeout);
      if (!result.ok) { setLoadError(result.error.message); return; }
      setMaterials(result.value); setProgress(result.value.progress); setTranslationPage(result.value.progress.pageNumber);
      if (result.value.translationText) {
        try { setTranslationPages(parseTranslationPages(result.value.translationText)); }
        catch (error) { setTranslationError(error instanceof Error ? error.message : "中文翻译解析失败"); }
      } else setTranslationPages([]);
      const [lectureResult,cachedNotes]=await Promise.all([window.lectureMate.listLectureSessions(week.id),window.lectureMate.getStudyNotes(week.id).catch(()=>null)]); if(lectureResult.ok){setLectures(lectureResult.value);const first=lectureResult.value[0];setSelectedLectureId(first?.id??null);if(first) await loadLecture(first.id,result.value);} if (cachedNotes?.ok) setStudyNotes(cachedNotes.value);
      window.setTimeout(() => { saveReady.current = true; }, 0);
    }).catch((error: unknown) => {
      if (!active) return;
      window.clearTimeout(timeout);
      const detail = error instanceof Error ? error.message : String(error);
      setLoadError(`无法连接阅读器后台服务。请完全退出并重启 LectureMate。${detail ? `\n详细信息：${detail}` : ""}`);
    });
    return () => { active = false; window.clearTimeout(timeout); };
    // Lecture loading is scoped to this Week lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week.id]);

  const loadLecture=async(id:string,base?:ReaderMaterials)=>{setSelectedLectureId(id);setTranscriptError(null);setTranscriptTranslation(null);const result=await window.lectureMate.getLectureMaterials(id);if(!result.ok){setTranscriptError(result.error.message);return;}setMaterials(current=>({...current!,...(base??{}),transcriptText:result.value.transcriptText,transcriptJson:result.value.transcriptJson}));if(result.value.transcriptJson){try{setSegments(segmentTranscript(parseTranscriptJson(result.value.transcriptJson)));}catch(error){setSegments([]);setTranscriptError(error instanceof Error?error.message:"字幕时间数据解析失败");}}else setSegments([]);if(result.value.transcriptText){const cached=await window.lectureMate.getTranslationStatus(id);if(cached.ok)setTranscriptTranslation(cached.value);} updateProgress({transcriptScroll:0,activeTranscriptTimestamp:null});};

  useEffect(() => {
    if (!progress || !saveReady.current) return;
    const timer = window.setTimeout(() => { void window.lectureMate.updateReadingProgress(progress); }, 300);
    return () => window.clearTimeout(timer);
  }, [progress]);
  useEffect(() => { void window.lectureMate.listAIAnalysisJobs().then(result=>{const job=result.ok&&result.value.find(value=>value.weekId===week.id&&["queued","running"].includes(value.status));if(job){setStudyBusy(true);setStudyProgress(job.progress);}}); return window.lectureMate.onAIAnalysisJob((job) => { if (job.weekId !== week.id) return; setStudyProgress(job.progress); setStudyBusy(["queued","running"].includes(job.status)); if(job.status==="completed")void window.lectureMate.getStudyNotes(week.id).then(result=>{if(result.ok){setStudyNotes(result.value);setStudyOpen(true);}}); if(job.status==="failed")setStudyError(job.error??"AI 分析未完成"); }); }, [week.id]);

  const updateProgress = useCallback((update: Partial<ReadingProgress>) => setProgress((current) => current ? { ...current, ...update, updatedAt: new Date().toISOString() } : current), []);
  const setPage = useCallback((page: number) => updateProgress({ pageNumber: Math.max(1, page) }), [updateProgress]);
  useEffect(() => { if (progress?.translationSync) setTranslationPage(progress.pageNumber); }, [progress?.pageNumber, progress?.translationSync]);

  if (loadError) return <div className="reader-fatal"><h2>无法打开阅读器</h2><p>{loadError}</p><button className="primary" onClick={onBack}>返回周次</button></div>;
  if (!materials || !progress) return <div className="reader-loading">正在加载课程资料…</div>;

  const translation = translationPages.find((page) => page.pageNumber === translationPage);
  const acceptAI = async () => { const current = await window.lectureMate.getAISettings(); if (!current.ok) { setStudyError(current.error.message); return false; } if (current.value.consentAccepted) return true; if (!confirm("AI 功能会将当前需要分析的课程文本发送到所配置的第三方 AI 服务。请确认课程资料允许这样处理。")) return false; const saved = await window.lectureMate.updateAISettings({ provider: current.value.provider, model: current.value.model, baseUrl: current.value.baseUrl, consentAccepted: true }); return saved.ok; };
  const translateSentence = async (orderIndex: number) => { if (!selectedLectureId||!await acceptAI()) return; setTranslatingSentence(orderIndex); setTranslationFailure(null); let status = transcriptTranslation; if (!status) { const loaded = await window.lectureMate.getTranslationStatus(selectedLectureId); if (!loaded.ok) { setTranslationFailure(loaded.error.message); setTranslatingSentence(null); return; } status = loaded.value; setTranscriptTranslation(status); } const cached = status.chunks.find((chunk) => chunk.orderIndex === orderIndex && chunk.sourceHash === status!.sourceChunks[orderIndex]?.sourceHash); if (!cached) { const result = await window.lectureMate.translateTranscriptChunk({ lectureSessionId:selectedLectureId, orderIndex }); if (!result.ok) setTranslationFailure(`第 ${orderIndex + 1} 句翻译失败：${result.error.message}`); else setTranscriptTranslation({ ...status, chunks: [...status.chunks.filter((chunk) => chunk.orderIndex !== orderIndex), result.value].sort((a,b) => a.orderIndex-b.orderIndex) }); } setTranslatingSentence(null); };
  const generateNotes = async (force = false) => { if (!await acceptAI()) return; if (force && studyNotes?.editedContent && !confirm("重新生成会覆盖你对 AI 笔记的人工编辑，确定继续吗？")) return; setStudyBusy(true); setStudyProgressHidden(false); setStudyError(null); setStudyProgress({ weekId: week.id, completed: 0, total: 1, pdfCompleted: 0, pdfTotal: 0, transcriptCompleted: 0, transcriptTotal: 0, cacheHits: 0, requests: 0, stage: "preparing", message: "正在提取英文 PDF 文本" }); try { const pdfPages = await extractPdfPages(materials.pdf); const result = await window.lectureMate.startStudyNotesJob({ weekId: week.id, pdfPages, force }); if (!result.ok){setStudyError(result.error.message);setStudyBusy(false);}else setStudyProgress(result.value.progress); } catch (error) { setStudyError(error instanceof Error ? error.message : "AI 分析失败"); setStudyBusy(false); } };
  const cancelAnalysis = async () => { await window.lectureMate.cancelStudyNotes(week.id); };
  const deleteNotes = async () => { if (!confirm("确定永久删除本周已保存的 AI 学习笔记吗？普通笔记和字幕翻译不会受影响。")) return; const result = await window.lectureMate.deleteStudyNotes(week.id); if (!result.ok) { setStudyError(result.error.message); return; } setStudyNotes(null); setStudyOpen(false); setStudyProgress(null); };
  return <div className="reader-shell">
    <div className="reader-titlebar"><button className="secondary compact" onClick={onBack}><ArrowLeft/> 返回周次</button><div><strong>{courseLabel}</strong><span>/</span><span>{week.name}</span></div><select aria-label="选择 Lecture" value={selectedLectureId??""} onChange={e=>void loadLecture(e.target.value)}><option value="">无 Lecture</option>{lectures.map(l=><option key={l.id} value={l.id}>{l.title}</option>)}</select><button className="secondary compact" onClick={()=>{setStudyOpen(false);setMyNotesOpen(true);}}><NotebookPen/>我的笔记</button><button className="secondary compact" onClick={() => {setMyNotesOpen(false);if(studyBusy)setStudyProgressHidden(false);else if(studyNotes)setStudyOpen(true);else void generateNotes();}}><Brain/>{studyBusy ? "正在分析…" : "AI 学习笔记"}</button><select value={progress.layout} onChange={(event) => updateProgress({ layout: event.target.value as LayoutMode })}>{Object.entries(layoutLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
    <ResizableWorkspace progress={progress} updateProgress={updateProgress}
      pdf={<PdfReader weekId={week.id} data={materials.pdf} progress={progress} updateProgress={updateProgress} onPageChange={setPage}/>} 
      translation={<TranslationReader page={translation} pageNumber={translationPage} pages={translationPages} sync={progress.translationSync} fontSize={translationFont} error={translationError} scrollTop={progress.translationScroll} onFont={setTranslationFont} onPage={setTranslationPage} onSync={(translationSync) => updateProgress({ translationSync })} onScroll={(translationScroll) => updateProgress({ translationScroll })}/>} 
      transcript={<TranscriptReader segments={segments} rawText={materials.transcriptText} error={transcriptError} fontSize={transcriptFont} scrollTop={progress.transcriptScroll} activeTimestamp={progress.activeTranscriptTimestamp} translation={transcriptTranslation} translatingSentence={translatingSentence} failure={translationFailure} onTranslate={(orderIndex) => void translateSentence(orderIndex)} onFont={setTranscriptFont} onScroll={(transcriptScroll) => updateProgress({ transcriptScroll })} onActive={(activeTranscriptTimestamp) => updateProgress({ activeTranscriptTimestamp: seekToTranscriptTime(activeTranscriptTimestamp) })}/>} />
    {studyError && <div className="ai-toast">{studyError}<button onClick={() => setStudyError(null)}><X/></button></div>}
    {studyBusy && studyProgress && !studyProgressHidden && <div className="ai-progress"><div><strong>正在生成 AI 学习笔记</strong><span>{studyProgress.message}</span></div><progress max={Math.max(1, studyProgress.total)} value={studyProgress.completed}/><small>PDF {studyProgress.pdfCompleted}/{studyProgress.pdfTotal} · 字幕 {studyProgress.transcriptCompleted}/{studyProgress.transcriptTotal} · 缓存 {studyProgress.cacheHits} · 请求 {studyProgress.requests}</small><button onClick={()=>setStudyProgressHidden(true)}>隐藏</button><button onClick={() => void cancelAnalysis()}>取消</button></div>}
    {studyOpen && studyNotes && <StudyNotesPanel stored={studyNotes} onClose={() => setStudyOpen(false)} onRegenerate={() => void generateNotes(true)} onDelete={() => void deleteNotes()} onPage={setPage} onChange={setStudyNotes}/>} 
    {myNotesOpen&&<MyNotesPanel weekId={week.id} currentPage={progress.pageNumber} onClose={()=>setMyNotesOpen(false)} onPage={setPage}/>} 
  </div>;
}

function MyNotesPanel({weekId,currentPage,onClose,onPage}:{weekId:string;currentPage:number;onClose:()=>void;onPage:(page:number)=>void}) {
  const [notes,setNotes]=useState<Note[]>([]);const [draft,setDraft]=useState("");const [editing,setEditing]=useState<Note|null>(null);const [attachPage,setAttachPage]=useState(false);const [error,setError]=useState<string|null>(null);
  const load=useCallback(async()=>{const result=await window.lectureMate.listNotes(weekId);if(result.ok)setNotes(result.value);else setError(result.error.message);},[weekId]);
  useEffect(()=>{void load();},[load]);
  const reset=()=>{setDraft("");setEditing(null);setAttachPage(false);};
  const save=async()=>{if(!draft.trim())return;const result=await window.lectureMate.saveNote({id:editing?.id,weekId,kind:attachPage?"page":"week",content:draft,pdfPage:attachPage?currentPage:undefined});if(!result.ok){setError(result.error.message);return;}reset();await load();};
  const remove=async(note:Note)=>{if(!confirm("确定删除这条笔记吗？"))return;const result=await window.lectureMate.deleteNote(note.id);if(!result.ok)setError(result.error.message);else{if(editing?.id===note.id)reset();await load();}};
  const edit=(note:Note)=>{setEditing(note);setDraft(note.content);setAttachPage(note.kind==="page"&&Boolean(note.pdfPage));};
  return <aside className="my-notes-panel"><header><div><NotebookPen/><strong>我的笔记</strong><small>{notes.length}条 · 自动保存在本机</small></div><button onClick={onClose}><X/></button></header><div className="note-composer"><textarea autoFocus value={draft} placeholder="写下自己的想法、总结或待复习内容…" onChange={e=>setDraft(e.target.value)}/><label><input type="checkbox" checked={attachPage} onChange={e=>setAttachPage(e.target.checked)}/>关联当前 PDF 第{currentPage}页</label><div>{editing&&<button className="secondary compact" onClick={reset}>取消编辑</button>}<button className="primary compact" disabled={!draft.trim()} onClick={()=>void save()}>{editing?"保存修改":"添加笔记"}</button></div></div>{error&&<p className="note-error">{error}</p>}<div className="my-notes-list">{notes.map(note=><article key={note.id}><p>{note.content}</p><footer>{note.pdfPage?<button onClick={()=>onPage(note.pdfPage!)}>PDF 第{note.pdfPage}页</button>:<span>{note.kind==="week"?"Week 笔记":note.kind}</span>}<time>{new Date(note.updatedAt).toLocaleString()}</time><button title="编辑" onClick={()=>edit(note)}>编辑</button><button title="删除" className="delete-note" onClick={()=>void remove(note)}><Trash2/></button></footer></article>)}{notes.length===0&&<div className="empty-my-notes"><NotebookPen/><strong>还没有笔记</strong><p>你可以在上方自由输入，也可以从 AI 学习笔记中加入内容。</p></div>}</div></aside>;
}

function ResizableWorkspace({ progress, updateProgress, pdf, translation, transcript }: { progress: ReadingProgress; updateProgress: (v: Partial<ReadingProgress>) => void; pdf: React.ReactNode; translation: React.ReactNode; transcript: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [focusSide, setFocusSide] = useState(false);
  const [focusTranscript, setFocusTranscript] = useState(false);
  const horizontal = progress.panelSizes[0] ?? 62;
  const vertical = progress.panelSizes[2] ?? 68;
  const drag = (axis: "x" | "y") => (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const rect = root.current?.getBoundingClientRect(); if (!rect) return;
      const value = axis === "x" ? ((moveEvent.clientX - rect.left) / rect.width) * 100 : ((moveEvent.clientY - rect.top) / rect.height) * 100;
      const clamped = Math.min(82, Math.max(25, value));
      const sizes = [...progress.panelSizes]; if (axis === "x") { sizes[0] = clamped; sizes[1] = 100 - clamped; } else { sizes[2] = clamped; sizes[3] = 100 - clamped; }
      updateProgress({ panelSizes: sizes });
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  if (progress.layout === "lecture-review") return <div ref={root} className="reader-workspace review-layout" style={{ gridTemplateColumns: `${horizontal}% 5px 1fr` }}><div>{pdf}</div><div className="resize-handle vertical" onPointerDown={drag("x")}/><div>{transcript}</div></div>;
  if (progress.layout === "pdf-focus") return <div ref={root} className="reader-workspace focus-layout"><div className="focus-buttons"><button onClick={() => setFocusSide((v) => !v)}>{focusSide ? <PanelLeftClose/> : <PanelLeftOpen/>} 中文</button><button onClick={() => setFocusTranscript((v) => !v)}><List/> 字幕</button></div><div>{pdf}</div>{focusSide && <aside className="focus-side">{translation}</aside>}{focusTranscript && <aside className="focus-transcript">{transcript}</aside>}</div>;
  return <div ref={root} className="reader-workspace bilingual-layout" style={{ gridTemplateRows: `${vertical}% 5px 1fr` }}><div className="reader-upper" style={{ gridTemplateColumns: `${horizontal}% 5px 1fr` }}><div>{pdf}</div><div className="resize-handle vertical" onPointerDown={drag("x")}/><div>{translation}</div></div><div className="resize-handle horizontal" onPointerDown={drag("y")}/><div>{transcript}</div></div>;
}

function PdfReader({ weekId, data, progress, updateProgress, onPageChange }: { weekId: string; data: Uint8Array; progress: ReadingProgress; updateProgress: (v: Partial<ReadingProgress>) => void; onPageChange: (page: number) => void }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<number[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);
  const [annotationMode, setAnnotationMode] = useState(false);
  const [annotationToolbarHost, setAnnotationToolbarHost] = useState<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });

  useEffect(() => {
    let active = true; const task = getDocument({ data: data.slice() });
    void task.promise.then((pdf) => { if (active) setDocument(pdf); }, (error: unknown) => {
      if (!active) return;
      const detail = error instanceof Error ? error.message : String(error);
      setPdfError(`PDF.js 无法启动或解析文件。${detail ? `详细信息：${detail}` : ""}`);
    });
    return () => { active = false; void task.destroy(); };
  }, [data]);
  useEffect(() => {
    const element = stageRef.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height })); observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!document || !canvasRef.current) return;
    let cancelled = false; let renderTask: { cancel(): void; promise: Promise<void> } | undefined;
    void document.getPage(Math.min(progress.pageNumber, document.numPages)).then((page) => {
      if (cancelled || !canvasRef.current) return;
      const base = page.getViewport({ scale: 1 });
      const scale = progress.fitMode === "width" ? Math.max(.25, (stageSize.width - 36) / base.width) : progress.fitMode === "page" ? Math.max(.25, Math.min((stageSize.width - 36) / base.width, (stageSize.height - 36) / base.height)) : progress.zoom;
      const viewport = page.getViewport({ scale }); const canvas = canvasRef.current; const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio); canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext("2d"); if (!context) return;
      renderTask = page.render({ canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      void renderTask.promise.catch((error: unknown) => { if (!cancelled && !(error instanceof Error && error.name === "RenderingCancelledException")) setPdfError("PDF 页面渲染失败"); });
    });
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [document, progress.pageNumber, progress.zoom, progress.fitMode, stageSize]);

  const go = useCallback((page: number) => { if (document) onPageChange(Math.min(document.numPages, Math.max(1, page))); }, [document, onPageChange]);
  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); go(progress.pageNumber - 1); }
      if (event.key === "ArrowRight") { event.preventDefault(); go(progress.pageNumber + 1); }
    };
    window.addEventListener("keydown", navigate);
    return () => window.removeEventListener("keydown", navigate);
  }, [go, progress.pageNumber]);
  const search = async () => {
    const term = query.trim().toLocaleLowerCase(); if (!document || !term) { setMatches([]); return; }
    setSearching(true); const found: number[] = [];
    try { for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) { const page = await document.getPage(pageNumber); const content = await page.getTextContent(); const text = content.items.map((item) => "str" in item ? item.str : "").join(" ").toLocaleLowerCase(); if (text.includes(term)) found.push(pageNumber); } }
    catch { setPdfError("PDF 文本搜索失败"); }
    setMatches(found); setMatchIndex(0); setSearching(false); if (found[0]) go(found[0]);
  };
  const moveMatch = (delta: number) => { if (!matches.length) return; const next = (matchIndex + delta + matches.length) % matches.length; setMatchIndex(next); go(matches[next]); };
  const zoom = (delta: number) => updateProgress({ fitMode: "custom", zoom: Math.min(3, Math.max(.4, progress.zoom + delta)) });
  const beginPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const stage = event.currentTarget;
    panRef.current = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add("is-panning");
  };
  const pan = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = panRef.current;
    if (!start) return;
    const stage = event.currentTarget;
    stage.scrollLeft = start.left - (event.clientX - start.x);
    stage.scrollTop = start.top - (event.clientY - start.y);
  };
  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    panRef.current = null;
    event.currentTarget.classList.remove("is-panning");
  };
  const pinchZoom = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.01);
    updateProgress({ fitMode: "custom", zoom: Math.min(3, Math.max(0.4, progress.zoom * factor)) });
  };
  if (pdfError) return <PanelError title="PDF 阅读器" message={pdfError}/>;
  return <section className={`reader-panel pdf-panel ${annotationMode ? "annotation-active" : ""}`}><div className="panel-toolbar"><button className={annotationMode ? "" : "active"} onClick={() => setAnnotationMode(false)}>阅读模式</button><button className={annotationMode ? "active" : ""} onClick={() => setAnnotationMode(true)}>标注模式</button><button title="缩略图" onClick={() => setThumbs((v) => !v)}>{thumbs ? <PanelLeftClose/> : <PanelLeftOpen/>}</button><button title="上一页" onClick={() => go(progress.pageNumber - 1)}><ChevronLeft/></button><input className="page-input" aria-label="页码" value={progress.pageNumber} onChange={(e) => go(Number(e.target.value) || 1)}/><span>/ {document?.numPages ?? "…"}</span><button title="下一页" onClick={() => go(progress.pageNumber + 1)}><ChevronRight/></button><i/><button title="缩小" onClick={() => zoom(-.1)}><Minus/></button><span>{Math.round(progress.zoom * 100)}%</span><button title="放大" onClick={() => zoom(.1)}><Plus/></button><button className={progress.fitMode === "width" ? "active" : ""} onClick={() => updateProgress({ fitMode: "width" })}>适合宽度</button><button className={progress.fitMode === "page" ? "active" : ""} onClick={() => updateProgress({ fitMode: "page" })}>适合页面</button></div><div className="searchbar"><Search/><input value={query} placeholder="搜索 PDF 文本" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }}/><button onClick={() => void search()} disabled={searching}>{searching ? "搜索中…" : "搜索"}</button>{matches.length > 0 && <><span>{matchIndex + 1}/{matches.length}</span><button onClick={() => moveMatch(-1)}><ChevronUp/></button><button onClick={() => moveMatch(1)}><ChevronDown/></button></>}</div>{annotationMode && <div className="annotation-dock" ref={setAnnotationToolbarHost}/>}<div className="pdf-body">{thumbs && document && <div className="thumbnails">{Array.from({ length: document.numPages }, (_, i) => <Thumbnail document={document} pageNumber={i + 1} active={progress.pageNumber === i + 1} onSelect={go} key={i}/>)}</div>}<div className="pdf-stage" ref={stageRef} onPointerDown={annotationMode ? undefined : beginPan} onPointerMove={annotationMode ? undefined : pan} onPointerUp={annotationMode ? undefined : endPan} onPointerCancel={annotationMode ? undefined : endPan} onWheel={pinchZoom}><div className="pdf-page-coordinate"><canvas ref={canvasRef}/><AnnotationLayer weekId={weekId} pageNumber={progress.pageNumber} enabled={annotationMode} toolbarHost={annotationToolbarHost} transcriptStartMs={progress.activeTranscriptTimestamp}/></div></div></div></section>;
}

function Thumbnail({ document, pageNumber, active, onSelect }: { document: PDFDocumentProxy; pageNumber: number; active: boolean; onSelect: (page: number) => void }) {
  const ref = useRef<HTMLButtonElement>(null); const canvas = useRef<HTMLCanvasElement>(null); const [visible, setVisible] = useState(false);
  useEffect(() => { const el = ref.current; if (!el) return; const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setVisible(true); }, { rootMargin: "120px" }); observer.observe(el); return () => observer.disconnect(); }, []);
  useEffect(() => { if (!visible || !canvas.current) return; let task: { cancel(): void } | undefined; void document.getPage(pageNumber).then((page: PDFPageProxy) => { if (!canvas.current) return; const base = page.getViewport({ scale: 1 }); const viewport = page.getViewport({ scale: 112 / base.width }); canvas.current.width = viewport.width; canvas.current.height = viewport.height; const context = canvas.current.getContext("2d"); if (context) task = page.render({ canvasContext: context, viewport }); }); return () => task?.cancel(); }, [visible, document, pageNumber]);
  return <button ref={ref} className={active ? "active" : ""} onClick={() => onSelect(pageNumber)}>{visible && <canvas ref={canvas}/>}<span>{pageNumber}</span></button>;
}

function TranslationReader({ page, pageNumber, pages, sync, fontSize, error, scrollTop, onFont, onPage, onSync, onScroll }: { page?: TranslationPage; pageNumber: number; pages: TranslationPage[]; sync: boolean; fontSize: number; error: string | null; scrollTop: number; onFont: (n: number) => void; onPage: (n: number) => void; onSync: (v: boolean) => void; onScroll: (n: number) => void }) {
  const body = useRef<HTMLDivElement>(null); useEffect(() => { if (body.current && !sync) body.current.scrollTop = scrollTop; }, [sync, scrollTop]);
  useEffect(() => { if (body.current && sync) body.current.scrollTop = 0; }, [pageNumber, sync]);
  if (error) return <PanelError title="中文翻译" message={error}/>;
  return <section className="reader-panel translation-panel"><div className="panel-toolbar"><strong>中文翻译</strong><label className="sync-toggle"><input type="checkbox" checked={sync} onChange={(e) => onSync(e.target.checked)}/> 跟随 PDF</label><i/><button title="减小字号" onClick={() => onFont(Math.max(13, fontSize - 1))}><Minus/></button><span>{fontSize}px</span><button title="增大字号" onClick={() => onFont(Math.min(28, fontSize + 1))}><Plus/></button><button title="复制本页" onClick={() => void navigator.clipboard.writeText(page?.content ?? "")}><Copy/></button></div>{!sync && <div className="translation-nav"><button onClick={() => onPage(Math.max(1, pageNumber - 1))}><ChevronLeft/></button><span>第{pageNumber}页</span><button onClick={() => onPage(pageNumber + 1)}><ChevronRight/></button><select value={pageNumber} onChange={(e) => onPage(Number(e.target.value))}>{pages.map((item) => <option value={item.pageNumber} key={item.pageNumber}>第{item.pageNumber}页</option>)}</select></div>}<div ref={body} className="translation-body" style={{ fontSize }} onScroll={(e) => { if (!sync) onScroll(e.currentTarget.scrollTop); }}><div className="translation-page-title">第{pageNumber}页</div>{page ? <div className="translation-content">{page.content}</div> : <div className="missing-content">第{pageNumber}页暂无中文翻译</div>}</div></section>;
}

function TranscriptReader({ segments, rawText, error, fontSize, scrollTop, activeTimestamp, translation, translatingSentence, failure, onTranslate, onFont, onScroll, onActive }: { segments: TranscriptSegment[]; rawText: string | null; error: string | null; fontSize: number; scrollTop: number; activeTimestamp: number | null; translation: TranslationStatus | null; translatingSentence: number | null; failure: string | null; onTranslate: (orderIndex: number) => void; onFont: (n: number) => void; onScroll: (n: number) => void; onActive: (n: number) => void }) {
  const [query, setQuery] = useState(""); const [result, setResult] = useState(0); const body = useRef<HTMLDivElement>(null); const refs = useRef(new Map<number, HTMLElement>());
  const sentences = useMemo(() => translation?.sourceChunks ?? [], [translation?.sourceChunks]);
  const matches = useMemo(() => { const term = query.trim().toLocaleLowerCase(); return term ? sentences.filter((sentence) => sentence.sourceText.toLocaleLowerCase().includes(term)).map((sentence) => sentence.orderIndex) : []; }, [sentences, query]);
  useEffect(() => { if (body.current) body.current.scrollTop = scrollTop; }, [scrollTop]);
  const move = (delta: number) => { if (!matches.length) return; const next = (result + delta + matches.length) % matches.length; setResult(next); refs.current.get(matches[next])?.scrollIntoView({ block: "center" }); };
  const highlight = (text: string) => { const term = query.trim(); if (!term) return text; return text.split(new RegExp(`(${escapeRegExp(term)})`, "ig")).map((part, i) => part.toLocaleLowerCase() === term.toLocaleLowerCase() ? <mark key={i}>{part}</mark> : part); };
  if (error && !rawText) return <PanelError title="课堂字幕" message={error}/>;
  return <section className="reader-panel transcript-panel"><div className="panel-toolbar"><strong>课堂字幕</strong><div className="inline-search"><Search/><input value={query} placeholder="搜索字幕" onChange={(e) => { setQuery(e.target.value); setResult(0); }}/>{query && <span>{matches.length ? `${result + 1}/${matches.length}` : "0/0"}</span>}<button onClick={() => move(-1)}><ChevronUp/></button><button onClick={() => move(1)}><ChevronDown/></button></div><i/><span className="translation-hint">点击单句翻译</span><button onClick={() => onFont(Math.max(12, fontSize - 1))}><Minus/></button><span>{fontSize}px</span><button onClick={() => onFont(Math.min(24, fontSize + 1))}><Plus/></button><button title="复制全部原文" onClick={() => void navigator.clipboard.writeText(rawText ?? "")}><Copy/></button></div><div ref={body} className="transcript-body sentence-list" style={{ fontSize }} onScroll={(e) => onScroll(e.currentTarget.scrollTop)}>{error && <div className="transcript-warning">{error}，字幕正文仍使用 TXT。</div>}{failure && <div className="transcript-warning">{failure}。可再次点击该句重试。</div>}{translation?.stale && <div className="transcript-warning">字幕 TXT 已变化，旧翻译已失效。</div>}{sentences.length ? sentences.map((sentence) => { const translated = translation?.chunks.find((chunk) => chunk.orderIndex === sentence.orderIndex && chunk.sourceHash === sentence.sourceHash); const timestamp = segments[sentence.orderIndex]?.startMs; return <article ref={(element) => { if (element) refs.current.set(sentence.orderIndex, element); }} className={timestamp !== undefined && activeTimestamp === timestamp ? "active" : ""} key={sentence.id}><div className="sentence-source">{timestamp !== undefined && <button className="sentence-time" onClick={() => onActive(timestamp)}>{formatTranscriptTime(timestamp)}</button>}<p>{highlight(sentence.sourceText)}</p><button className="sentence-translate" disabled={translatingSentence !== null} onClick={() => onTranslate(sentence.orderIndex)}>{translatingSentence === sentence.orderIndex ? "翻译中…" : translated ? "重新显示" : "翻译"}</button></div>{translated && <div className="sentence-translation"><span>译</span><p>{translated.translatedText}</p><button title="复制译文" onClick={() => void navigator.clipboard.writeText(translated.translatedText)}><Copy/></button></div>}</article>; }) : rawText ? <div className="missing-content">正在准备单句字幕…</div> : <div className="missing-content">本周尚未导入课堂字幕</div>}</div></section>;
}

const studySections: { key: keyof WeekStudyNotes; label: string }[] = [{ key: "coreConcepts", label: "核心知识" },{ key: "teacherEmphasis", label: "老师重点" },{ key: "lectureAdditions", label: "课堂补充" },{ key: "confusingConcepts", label: "易混淆概念" },{ key: "examples", label: "课堂实例" },{ key: "assessmentInfo", label: "考试 / Quiz 信息" },{ key: "formulasAndDefinitions", label: "公式与定义" },{ key: "reviewPriorities", label: "复习优先级" }];
function StudyNotesPanel({ stored, onClose, onRegenerate, onDelete, onPage, onChange }: { stored: StoredWeekStudyNotes; onClose: () => void; onRegenerate: () => void; onDelete: () => void; onPage: (page: number) => void; onChange: (v: StoredWeekStudyNotes) => void }) {
  const content = stored.editedContent ?? stored.generatedContent; const [summary, setSummary] = useState(content.finalSummary); const [error, setError] = useState<string | null>(null);
  const initialWidth=Math.min(520,window.innerWidth*.58);const panelRef = useRef<HTMLElement>(null); const [panelWidth,setPanelWidth]=useState(initialWidth);const [position,setPosition]=useState(()=>({x:Math.max(12,window.innerWidth-initialWidth-18),y:58})); const [openEvidence,setOpenEvidence]=useState<Set<string>>(new Set());
  const save = async () => { const result = await window.lectureMate.saveEditedStudyNotes(stored.weekId, { ...content, finalSummary: summary }); if (result.ok) onChange(result.value); else setError(result.error.message); };
  const addNote = async (title: string, text: string) => { const result = await window.lectureMate.saveNote({ weekId: stored.weekId, kind: "week", content: `${title}\n${text}` }); if (!result.ok) setError(result.error.message); };
  const beginDrag=(event:React.PointerEvent<HTMLElement>)=>{if((event.target as HTMLElement).closest("button"))return;event.currentTarget.setPointerCapture(event.pointerId);const start={pointerX:event.clientX,pointerY:event.clientY,panelX:position.x,panelY:position.y};const move=(e:PointerEvent)=>{const rect=panelRef.current?.getBoundingClientRect();const width=rect?.width??520,height=rect?.height??600;setPosition({x:Math.max(0,Math.min(window.innerWidth-width,start.panelX+e.clientX-start.pointerX)),y:Math.max(0,Math.min(window.innerHeight-height,start.panelY+e.clientY-start.pointerY))});};const stop=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",stop);};window.addEventListener("pointermove",move);window.addEventListener("pointerup",stop);};
  const beginResize=(event:React.PointerEvent<HTMLDivElement>)=>{event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);const right=position.x+panelWidth;const move=(e:PointerEvent)=>{const width=Math.max(340,Math.min(window.innerWidth-24,right,right-e.clientX));setPanelWidth(width);setPosition(current=>({...current,x:right-width}));};const stop=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",stop);};window.addEventListener("pointermove",move);window.addEventListener("pointerup",stop);};
  const toggleEvidence=(id:string)=>setOpenEvidence(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});
  return <aside ref={panelRef} className="study-notes-panel" style={{left:position.x,top:position.y,width:panelWidth}}><div className="study-width-handle" title="拖动调整宽度" onPointerDown={beginResize}/><header onPointerDown={beginDrag}><div><Brain/><strong>AI 学习笔记</strong><small>{stored.model} · 拖动标题栏移动 · 拖动左边缘调整宽度 · {stored.editedContent ? "已人工编辑" : "AI 生成"}</small></div><button onClick={onClose}><X/></button></header><div className="study-actions"><button onClick={() => void navigator.clipboard.writeText(JSON.stringify(content, null, 2))}><Copy/>复制</button><button onClick={onRegenerate}>重新生成</button><span/><button className="delete-study-notes" onClick={onDelete}>删除 AI 笔记</button></div><div className="study-scroll">{studySections.map(({ key, label }) => { const values = content[key]; if (!Array.isArray(values)) return null; return <details open key={key}><summary>{label}<span>{values.length}</span></summary>{values.map((item, index) => {const evidence=item.evidence??[];const evidenceId=`${String(key)}-${index}`;const evidenceOpen=openEvidence.has(evidenceId);return <article key={`${item.title}-${index}`}><div className="insight-title"><strong>{item.title}</strong>{item.importance && <span title="AI 评估的重要度">AI 重要度 {"★".repeat(item.importance)}</span>}</div>{item.expression&&<code className="formula-expression">{item.expression}</code>}<p>{item.meaning??item.statement??item.summary}</p>{item.variables?.length&&<small>变量：{item.variables.join(" · ")}</small>}{item.emphasisType && <small>{item.emphasisType === "explicit" ? "老师明确强调" : "AI 根据讲解推断"}</small>}{key==="teacherEmphasis"&&item.reasons?.length&&<div className="emphasis-reasons"><strong>依据：</strong>{item.reasons.map(reason=><span key={reason}>• {reason}</span>)}</div>}<div className="evidence"><button className="evidence-toggle" disabled={!evidence.length} onClick={()=>toggleEvidence(evidenceId)}>{evidenceOpen?"收起原文":`查看 Transcript 原文（${evidence.length}）`}</button>{evidenceOpen&&<div className="evidence-list">{evidence.map((e, i) => <button key={i} title={e.pageNumber?`跳转到 PDF 第 ${e.pageNumber} 页`:"课程依据"} onClick={() => e.pageNumber && onPage(e.pageNumber)}>{e.source === "pdf" && e.pageNumber ? `PPT 第 ${e.pageNumber} 页（点击跳转）：` : e.lectureTitle?`${e.lectureTitle}：`:`${e.source}：`}{e.text}</button>)}</div>}</div><button className="add-note" onClick={() => void addNote(item.title, item.summary)}>加入我的笔记</button></article>;})}</details>; })}<section className="final-summary"><h3>最终复习摘要</h3><textarea value={summary} onChange={(e) => setSummary(e.target.value)}/><button className="primary compact" disabled={summary === content.finalSummary} onClick={() => void save()}>保存人工编辑</button></section>{error && <p className="note-error">{error}</p>}</div></aside>;
}


function PanelError({ title, message }: { title: string; message: string }) { return <section className="reader-panel panel-error"><FileSearch/><h3>{title}不可用</h3><p>{message}</p></section>; }
async function extractPdfPages(data: Uint8Array): Promise<PdfPageContent[]> { const task = getDocument({ data: data.slice() }); const document = await task.promise; const pages: PdfPageContent[] = []; try { for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) { const page = await document.getPage(pageNumber); const content = await page.getTextContent(); pages.push({ pageNumber, text: content.items.map((item) => "str" in item ? item.str : "").join(" ") }); } return pages; } finally { await task.destroy(); } }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
