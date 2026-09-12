import { useEffect, useMemo, useState } from "react";
import { BookOpen, Brain, Check, ChevronDown, ChevronRight, FileJson, FileText, MoreHorizontal, Moon, PanelLeftClose, PanelLeftOpen, Play, Plus, Settings, Sun, Trash2, Upload, X } from "lucide-react";
import type { AISettingsInput, CourseInput } from "../shared/contracts";
import { DEFAULT_SETTINGS, type AISettings, type AiAnalysisJob, type AppSettings, type Course, type CourseTree, type LectureSession, type Theme, type WeekFileKind, type WeekWithFiles } from "../shared/domain";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Reader } from "./components/Reader";

const colors = ["#5b6ee1", "#169b83", "#c26b3d", "#a85574", "#7c62b3", "#3678a8"];
const emptyCourse: CourseInput = { code: "", name: "", color: colors[0], icon: "BookOpen" };
const fileRows: { kind: WeekFileKind; label: string; hint: string }[] = [
  { kind: "pdf", label: "原始 PDF", hint: "阅读所需的课程 PDF" },
  { kind: "translation", label: "中文翻译", hint: "纯文本文件（.txt）" },
];
const themeLabels: Record<Theme, string> = { light: "浅色", dark: "深色", system: "跟随系统" };

function AppContent() {
  const [tree, setTree] = useState<CourseTree[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [courseDialog, setCourseDialog] = useState<Course | "new" | null>(null);
  const [courseForm, setCourseForm] = useState<CourseInput>(emptyCourse);
  const [weekDialog, setWeekDialog] = useState<WeekWithFiles | "new" | null>(null);
  const [weekName, setWeekName] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dataDirectory, setDataDirectory] = useState("");
  const [aiSettings, setAISettings] = useState<AISettings>({ provider: "openrouter", model: "openrouter/free", baseUrl: "https://openrouter.ai/api/v1", hasApiKey: false, consentAccepted: false, concurrency: 4, routing: "throughput" });
  const [apiKey, setApiKey] = useState(""); const [aiMessage, setAIMessage] = useState<string | null>(null); const [aiBusy, setAIBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readerWeekId, setReaderWeekId] = useState<string | null>(null);
  const [sidebarCollapsed,setSidebarCollapsed]=useState(false);
  const [aiJobs,setAIJobs]=useState<AiAnalysisJob[]>([]); const [aiNotice,setAINotice]=useState<AiAnalysisJob|null>(null);

  const selectedCourse = tree.find((course) => course.id === selectedCourseId) ?? null;
  const selectedWeek = selectedCourse?.weeks.find((week) => week.id === selectedWeekId) ?? null;

  const refresh = async () => {
    const result = await window.lectureMate.getCourseTree();
    if (!result.ok) return setError(result.error.message);
    setTree(result.value);
    return result.value;
  };
  useEffect(() => { void (async () => {
    const [treeResult, settingsResult] = await Promise.all([window.lectureMate.getCourseTree(), window.lectureMate.getSettings()]);
    if (!treeResult.ok) return setError(treeResult.error.message);
    const loadedSettings = settingsResult.ok ? settingsResult.value : DEFAULT_SETTINGS;
    setTree(treeResult.value); setSettings(loadedSettings);
    const course = treeResult.value.find((item) => item.id === loadedSettings.lastCourseId) ?? treeResult.value[0];
    const week = course?.weeks.find((item) => item.id === loadedSettings.lastWeekId) ?? course?.weeks[0];
    setSelectedCourseId(course?.id ?? null); setSelectedWeekId(week?.id ?? null);
    if (course) setExpanded(new Set([course.id]));
  })(); }, []);
  useEffect(() => {
    const dark = settings.theme === "dark" || (settings.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [settings.theme]);
  useEffect(()=>{void window.lectureMate.listAIAnalysisJobs().then(result=>{if(result.ok)setAIJobs(result.value);});return window.lectureMate.onAIAnalysisJob(job=>{setAIJobs(current=>[...current.filter(value=>value.weekId!==job.weekId),job]);if(job.status==="completed"||job.status==="failed")setAINotice(job);});},[]);

  const select = async (courseId: string, weekId: string | null) => {
    setReaderWeekId(null);
    setSelectedCourseId(courseId); setSelectedWeekId(weekId); setExpanded((old) => new Set(old).add(courseId));
    const result = await window.lectureMate.updateSettings({ lastCourseId: courseId, lastWeekId: weekId });
    if (result.ok) setSettings(result.value);
  };
  const run = async (operation: () => Promise<{ ok: true; value: unknown } | { ok: false; error: { message: string } }>) => {
    setBusy(true); setError(null);
    const result = await operation(); setBusy(false);
    if (!result.ok) { setError(result.error.message); return false; }
    await refresh(); return true;
  };
  const saveCourse = async () => {
    const editing = courseDialog !== "new" && courseDialog;
    const ok = await run(() => editing ? window.lectureMate.updateCourse({ ...courseForm, id: editing.id }) : window.lectureMate.createCourse(courseForm));
    if (ok) setCourseDialog(null);
  };
  const saveWeek = async () => {
    if (!selectedCourseId) return;
    const editing = weekDialog !== "new" && weekDialog;
    setBusy(true); setError(null);
    const result = editing
      ? await window.lectureMate.updateWeek({ id: editing.id, name: weekName })
      : await window.lectureMate.createWeek({ courseId: selectedCourseId, name: weekName || undefined });
    setBusy(false);
    if (!result.ok) { setError(result.error.message); return; }
    await refresh();
    setWeekDialog(null);
    await select(result.value.courseId, result.value.id);
  };
  const deleteCourse = async (course: Course) => {
    if (!confirm(`确定删除“${course.code || course.name}”及其全部周次吗？LectureMate 管理的文件副本也会一并删除。`)) return;
    if (await run(() => window.lectureMate.deleteCourse(course.id))) { setSelectedCourseId(null); setSelectedWeekId(null); }
  };
  const deleteWeek = async (week: WeekWithFiles) => {
    if (!confirm(`确定删除“${week.name}”吗？LectureMate 管理的文件副本也会一并删除。`)) return;
    if (await run(() => window.lectureMate.deleteWeek(week.id))) setSelectedWeekId(null);
  };
  const importFile = async (kind: WeekFileKind) => {
    if (!selectedWeek) return;
    const existing = selectedWeek.files.some((file) => file.kind === kind);
    if (existing && !confirm("确定替换现有文件吗？已有笔记以及后续的分析记录会尽可能保留。")) return;
    await run(() => window.lectureMate.importWeekFile({ weekId: selectedWeek.id, kind }));
  };
  const changeTheme = async (theme: Theme) => { const result = await window.lectureMate.updateSettings({ theme }); if (result.ok) setSettings(result.value); else setError(result.error.message); };
  const openSettings = async () => { const [directory, ai] = await Promise.all([window.lectureMate.getDataDirectory(), window.lectureMate.getAISettings()]); if (directory.ok) setDataDirectory(directory.value); if (ai.ok) setAISettings(ai.value); setApiKey(""); setAIMessage(null); setSettingsOpen(true); };
  const aiInput = (): AISettingsInput => ({ provider: "openrouter", model: aiSettings.model, baseUrl: aiSettings.baseUrl, concurrency: aiSettings.concurrency, routing: aiSettings.routing, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) });
  const saveAI = async () => { setAIBusy(true); setAIMessage(null); const result = await window.lectureMate.updateAISettings(aiInput()); setAIBusy(false); if (result.ok) { setAISettings(result.value); setApiKey(""); setAIMessage("AI 设置已安全保存"); } else setAIMessage(result.error.message); };
  const testAI = async () => { setAIBusy(true); setAIMessage("正在测试连接…"); const result = await window.lectureMate.testAIConnection(aiInput()); setAIBusy(false); if (result.ok) { const current = await window.lectureMate.getAISettings(); if (current.ok) setAISettings(current.value); setApiKey(""); setAIMessage("连接成功"); } else setAIMessage(`连接失败：${result.error.message}`); };

  const completion = useMemo(() => selectedWeek ? selectedWeek.files.filter(f=>f.kind==="pdf"||f.kind==="translation").length : 0, [selectedWeek]);
  const activeAI=aiJobs.find(job=>["queued","running"].includes(job.status)); const openAIJob=(job:AiAnalysisJob)=>{for(const course of tree){const week=course.weeks.find(value=>value.id===job.weekId);if(week){void select(course.id,week.id);setReaderWeekId(week.id);setAINotice(null);break;}}}; const jobLabel=(job:AiAnalysisJob)=>{for(const course of tree){const week=course.weeks.find(value=>value.id===job.weekId);if(week)return `${course.code||course.name} / ${week.name}`;}return "当前 Week";};
  return <div className={`app-shell ${sidebarCollapsed?"sidebar-collapsed":""}`}>
    <header className="topbar"><div className="brand"><span className="brand-mark"><BookOpen size={17}/></span>LectureMate</div><div className="crumbs"><button className="icon-button sidebar-toggle" title={sidebarCollapsed?"展开我的课程":"收起我的课程"} aria-label={sidebarCollapsed?"展开我的课程":"收起我的课程"} onClick={()=>setSidebarCollapsed(value=>!value)}>{sidebarCollapsed?<PanelLeftOpen/>:<PanelLeftClose/>}</button>{selectedCourse ? <><span>{selectedCourse.code || selectedCourse.name}</span><ChevronRight size={14}/><strong>{selectedWeek?.name ?? "课程概览"}</strong></> : <span>我的课程</span>}</div>{activeAI&&<button className="ai-job-indicator" onClick={()=>openAIJob(activeAI)}><Brain size={15}/> AI 分析中 {Math.round(activeAI.progress.completed/Math.max(1,activeAI.progress.total)*100)}%</button>}<button className="icon-button" title="设置" aria-label="设置" onClick={() => void openSettings()}><Settings size={18}/></button></header>
    <aside className="sidebar">
      <div className="section-heading"><span>我的课程</span><button className="mini-button" title="新建课程" aria-label="新建课程" onClick={() => { setCourseForm(emptyCourse); setCourseDialog("new"); }}><Plus size={15}/></button></div>
      <nav>{tree.map((course) => <div className="course-group" key={course.id}>
        <div className={`course-row ${selectedCourseId === course.id && !selectedWeekId ? "selected" : ""}`} onClick={() => void select(course.id, null)}>
          <button className="disclosure" onClick={(event) => { event.stopPropagation(); setExpanded((old) => { const next = new Set(old); if (next.has(course.id)) next.delete(course.id); else next.add(course.id); return next; }); }}>{expanded.has(course.id) ? <ChevronDown/> : <ChevronRight/>}</button>
          <span className="course-dot" style={{ background: course.color }}/><span className="course-title"><strong>{course.code || course.name}</strong>{course.code && <small>{course.name}</small>}</span>
          <button className="row-action" onClick={(event) => { event.stopPropagation(); setCourseForm(course); setCourseDialog(course); }}><MoreHorizontal/></button>
        </div>
        {expanded.has(course.id) && <div className="weeks">{course.weeks.map((week) => <button className={`week-row ${week.id === selectedWeekId ? "selected" : ""}`} key={week.id} onClick={() => void select(course.id, week.id)}><span>{week.name}</span>{week.files.some((file) => file.kind === "pdf") && <Check size={13}/>}</button>)}<button className="add-week" onClick={() => { void select(course.id, null); setWeekName(""); setWeekDialog("new"); }}><Plus size={14}/> 添加周次</button></div>}
      </div>)}</nav>
      {tree.length === 0 && <div className="sidebar-empty">创建第一门课程，开始整理你的课堂资料。</div>}
    </aside>
    <main className="content">
      {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError(null)}><X/></button></div>}
      {!selectedCourse && <section className="welcome"><div className="welcome-icon"><BookOpen/></div><p className="eyebrow">本地优先的学习工作区</p><h1>让课程资料井然有序</h1><p>创建课程、添加周次，再导入已有的学习资料。所有内容都保存在这台 Mac 上。</p><button className="primary" onClick={() => { setCourseForm(emptyCourse); setCourseDialog("new"); }}><Plus/> 创建第一门课程</button></section>}
      {selectedCourse && !selectedWeek && <CourseHome course={selectedCourse} onSelectWeek={(weekId) => void select(selectedCourse.id, weekId)} onAddWeek={() => { setWeekName(""); setWeekDialog("new"); }} onEdit={() => { setCourseForm(selectedCourse); setCourseDialog(selectedCourse); }} />}
      {selectedCourse && selectedWeek && readerWeekId === selectedWeek.id && <Reader week={selectedWeek} courseLabel={selectedCourse.code || selectedCourse.name} onBack={() => setReaderWeekId(null)}/>} 
      {selectedCourse && selectedWeek && readerWeekId !== selectedWeek.id && <section className="week-home">
        <div className="page-header"><div><p className="eyebrow">{selectedCourse.code || selectedCourse.name} / 第{selectedWeek.position}周</p><h1>{selectedWeek.name}</h1><p>PDF、翻译与多个 Lecture 分开管理</p></div><button className="secondary" onClick={() => { setWeekName(selectedWeek.name); setWeekDialog(selectedWeek); }}><MoreHorizontal/> 管理周次</button></div>
        <div className="status-strip"><div><span className="progress-ring">{completion}/2</span><div><strong>资料状态</strong><p>{selectedWeek.files.some((f) => f.kind === "pdf") ? "已具备进入阅读阶段的条件" : "请先导入本周课程 PDF"}</p></div></div><span className="phase-badge">Phase 4.1</span></div>
        <div className="materials"><div className="card-heading"><div><h2>学习资料</h2><p>LectureMate 会保存受管理的文件副本，绝不会修改你的原始文件。</p></div></div>
          {fileRows.map((row) => { const file = selectedWeek.files.find((item) => item.kind === row.kind); const Icon = row.kind === "transcript_json" ? FileJson : row.kind === "pdf" ? BookOpen : FileText; return <div className="file-row" key={row.kind}><span className={`file-icon ${file ? "ready" : ""}`}><Icon/></span><div className="file-info"><strong>{row.label}</strong><small>{file ? file.originalName : row.hint}</small></div><span className={`file-state ${file ? "ready" : ""}`}>{file ? <><Check/> 已导入</> : "未导入"}</span><button className="secondary compact" disabled={busy} onClick={() => void importFile(row.kind)}><Upload/>{file ? "替换文件" : "选择文件"}</button></div>; })}
        </div>
        <LectureManager weekId={selectedWeek.id} busy={busy} setBusy={setBusy} setError={setError}/>
        {selectedWeek.files.some((file) => file.kind === "pdf") ? <div className="reader-entry"><div><Play/><div><h2>课程阅读工作区</h2><p>同时阅读 PDF、中文翻译和带时间戳的课堂字幕。</p></div></div><button className="primary" onClick={() => setReaderWeekId(selectedWeek.id)}><BookOpen/> 开始阅读</button></div> : <div className="reader-placeholder"><div><BookOpen/><h2>请先导入课程 PDF</h2><p>导入 PDF 后即可进入课程阅读工作区。</p></div></div>}
      </section>}
    </main>
    {aiNotice&&<div className={`ai-global-toast ${aiNotice.status}`}><Brain/><div><strong>{jobLabel(aiNotice)} AI {aiNotice.status==="completed"?"学习笔记已生成完成":"分析未完成"}</strong><span>{aiNotice.status==="failed"?aiNotice.error:"点击查看笔记"}</span></div><button className="primary compact" onClick={()=>openAIJob(aiNotice)}>{aiNotice.status==="failed"?"继续生成":"查看笔记"}</button><button onClick={()=>setAINotice(null)}><X/></button></div>}
    {courseDialog && <Modal title={courseDialog === "new" ? "新建课程" : "编辑课程"} onClose={() => setCourseDialog(null)}><label>课程代码<input autoFocus value={courseForm.code} placeholder="例如：EE6111" onChange={(e) => setCourseForm({ ...courseForm, code: e.target.value })}/></label><label>课程名称<input value={courseForm.name} placeholder="例如：5G 通信与前沿技术" onChange={(e) => setCourseForm({ ...courseForm, name: e.target.value })}/></label><label>课程颜色<div className="color-list">{colors.map((color) => <button type="button" aria-label={`选择颜色 ${color}`} key={color} className={courseForm.color === color ? "active" : ""} style={{ background: color }} onClick={() => setCourseForm({ ...courseForm, color })}>{courseForm.color === color && <Check/>}</button>)}</div></label><div className="modal-actions">{courseDialog !== "new" && <button className="danger ghost" onClick={() => void deleteCourse(courseDialog)}><Trash2/> 删除课程</button>}<span/><button className="secondary" onClick={() => setCourseDialog(null)}>取消</button><button className="primary" disabled={busy || !courseForm.name.trim()} onClick={() => void saveCourse()}>{courseDialog === "new" ? "创建课程" : "保存修改"}</button></div></Modal>}
    {weekDialog && <Modal title={weekDialog === "new" ? "添加周次" : "编辑周次"} onClose={() => setWeekDialog(null)}><label>周次名称<input autoFocus value={weekName} placeholder={weekDialog === "new" ? "留空则自动命名为“第1周”“第2周”…" : "例如：第1周 · 课程简介"} onChange={(e) => setWeekName(e.target.value)}/></label><div className="modal-actions">{weekDialog !== "new" && <button className="danger ghost" onClick={() => void deleteWeek(weekDialog)}><Trash2/> 删除周次</button>}<span/><button className="secondary" onClick={() => setWeekDialog(null)}>取消</button><button className="primary" disabled={busy} onClick={() => void saveWeek()}>{weekDialog === "new" ? "添加周次" : "保存修改"}</button></div></Modal>}
    {settingsOpen && <Modal title="设置" onClose={() => setSettingsOpen(false)}><label>外观<div className="segmented">{(["light", "dark", "system"] as Theme[]).map((theme) => <button className={settings.theme === theme ? "active" : ""} onClick={() => void changeTheme(theme)} key={theme}>{theme === "light" ? <Sun/> : theme === "dark" ? <Moon/> : <Settings/>}{themeLabels[theme]}</button>)}</div></label><div className="settings-divider"><strong>AI 设置</strong><small>API Key 使用系统安全存储加密保存</small></div><label>服务商<input value="OpenRouter" disabled/></label><label>API Key<input type="password" autoComplete="off" value={apiKey} placeholder={aiSettings.hasApiKey ? "已安全保存；留空表示不修改" : "请输入 OpenRouter API Key"} onChange={(e) => setApiKey(e.target.value)}/></label><label>模型 ID<input value={aiSettings.model} onChange={(e) => setAISettings({ ...aiSettings, model: e.target.value })}/></label><label>Base URL<input value={aiSettings.baseUrl} onChange={(e) => setAISettings({ ...aiSettings, baseUrl: e.target.value })}/></label><label>Map 并发数（1–6）<input type="number" min="1" max="6" value={aiSettings.concurrency} onChange={(e) => setAISettings({ ...aiSettings, concurrency: Math.min(6, Math.max(1, Number(e.target.value) || 1)) })}/></label><label>OpenRouter 速度优先<select value={aiSettings.routing} onChange={(e) => setAISettings({ ...aiSettings, routing: e.target.value as AISettings["routing"] })}><option value="default">默认路由</option><option value="latency">低延迟优先</option><option value="throughput">高吞吐优先</option></select></label>{aiMessage && <p className={aiMessage.includes("失败") ? "ai-message error" : "ai-message"}>{aiMessage}</p>}<div className="ai-settings-actions"><button className="secondary" disabled={aiBusy} onClick={() => void testAI()}>测试连接</button><button className="secondary" disabled={aiBusy} onClick={() => void saveAI()}>保存 AI 设置</button></div><label>本地数据目录<code className="path">{dataDirectory}</code></label><p className="settings-note">课程资料仅在你主动使用 AI 功能时发送至所配置的第三方服务。速度优先只调整同一模型的 Provider 排序，不会更换模型。</p><div className="modal-actions"><span/><button className="primary" onClick={() => setSettingsOpen(false)}>完成</button></div></Modal>}
  </div>;
}

function LectureManager({weekId,busy,setBusy,setError}:{weekId:string;busy:boolean;setBusy:(v:boolean)=>void;setError:(v:string|null)=>void}) {
  const [lectures,setLectures]=useState<LectureSession[]>([]);
  const load=async()=>{const result=await window.lectureMate.listLectureSessions(weekId); if(result.ok)setLectures(result.value); else setError(result.error.message);};
  useEffect(()=>{void load();
    // `load` is intentionally recreated so it always uses the current Week and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[weekId]);
  const action=async(operation:()=>Promise<{ok:true;value:unknown}|{ok:false;error:{message:string}}>)=>{setBusy(true);const result=await operation();setBusy(false);if(!result.ok)setError(result.error.message);else await load();};
  const add=()=>void action(()=>window.lectureMate.createLectureSession({weekId}));
  return <div className="materials lecture-manager"><div className="card-heading"><div><h2>Lectures</h2><p>每场 Lecture 独立保存字幕、时间轴与翻译缓存。</p></div><button className="secondary compact" disabled={busy} onClick={add}><Plus/>添加 Lecture</button></div>{lectures.map((lecture,index)=><div className="lecture-card" key={lecture.id}><div className="lecture-title"><strong>{lecture.title}</strong><small>第{index+1}场 · 时间从 00:00 开始</small></div><button className="secondary compact" onClick={()=>{const title=prompt("Lecture 名称",lecture.title);if(title?.trim())void action(()=>window.lectureMate.updateLectureSession({id:lecture.id,title}));}}>重命名</button><button className="secondary compact" disabled={index===0} onClick={()=>void action(()=>window.lectureMate.moveLectureSession({id:lecture.id,direction:"up"}))}>上移</button><button className="secondary compact" disabled={index===lectures.length-1} onClick={()=>void action(()=>window.lectureMate.moveLectureSession({id:lecture.id,direction:"down"}))}>下移</button><button className="secondary compact" onClick={()=>void action(()=>window.lectureMate.importLectureAsset({lectureSessionId:lecture.id,kind:"transcript_txt"}))}><Upload/>{lecture.transcriptAsset?"替换 TXT":"导入 TXT"}</button><button className="secondary compact" onClick={()=>void action(()=>window.lectureMate.importLectureAsset({lectureSessionId:lecture.id,kind:"timestamp_json"}))}><Upload/>{lecture.timestampAsset?"替换 JSON":"导入 JSON"}</button><button className="danger ghost compact" onClick={()=>{if(confirm(`删除“${lecture.title}”及其字幕和翻译缓存？`))void action(()=>window.lectureMate.deleteLectureSession(lecture.id));}}><Trash2/></button></div>)}{lectures.length===0&&<p className="empty-lectures">尚无 Lecture，可添加后导入字幕。</p>}</div>;
}

function CourseHome({ course, onAddWeek, onEdit, onSelectWeek }: { course: CourseTree; onAddWeek: () => void; onEdit: () => void; onSelectWeek: (weekId: string) => void }) {
  const importedWeeks = course.weeks.filter((week) => week.files.some((file) => file.kind === "pdf")).length;
  return <section className="course-home"><div className="page-header"><div><p className="eyebrow">课程</p><h1>{course.code || course.name}</h1><p>{course.code ? course.name : "你的课堂学习工作区"}</p></div><button className="secondary" onClick={onEdit}><MoreHorizontal/> 编辑课程</button></div><div className="course-summary"><span className="large-dot" style={{ background: course.color }}><BookOpen/></span><div className="summary-copy"><strong>共{course.weeks.length}个周次</strong><p>已有<b>{importedWeeks}</b>个周次导入 PDF</p></div><button className="primary" onClick={onAddWeek}><Plus/> 添加周次</button></div><div className="week-grid">{course.weeks.map((week) => <button className="week-card" key={week.id} onClick={() => onSelectWeek(week.id)}><span>第{week.position}周</span><div><strong>{week.name}</strong><p>{week.files.length ? `已导入${week.files.length}类资料` : "暂无资料 · 点击导入"}</p></div><ChevronRight/></button>)}</div>{course.weeks.length === 0 && <div className="empty-card"><h2>还没有周次</h2><p>添加第一个周次，然后导入课程 PDF 和其他学习资料。</p><button className="primary" onClick={onAddWeek}><Plus/> 添加第1周</button></div>}</section>;
}
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) { return <div className="modal-backdrop" onMouseDown={(e) => { if (e.currentTarget === e.target) onClose(); }}><div className="modal"><div className="modal-header"><h2>{title}</h2><button className="icon-button" title="关闭" aria-label="关闭" onClick={onClose}><X/></button></div>{children}</div></div>; }
export function App() { return <ErrorBoundary><AppContent/></ErrorBoundary>; }
