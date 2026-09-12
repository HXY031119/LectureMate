import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Circle, Eraser, Highlighter, MousePointer2, PenLine, RectangleHorizontal, Redo2, StickyNote, Trash2, Type, Undo2, X } from "lucide-react";
import { normalizePoint, normalizedBox, takeRedo, takeUndo, type AnnotationHistoryEntry } from "../../shared/annotations";
import type { Annotation, AnnotationTool, ArrowAnnotation, BoxAnnotation, Note, NoteKind, NormalizedPoint, PenAnnotation, TextAnnotation } from "../../shared/domain";

const colors = ["#f2c94c", "#36b37e", "#3584e4", "#e05252"];
const tools: { id: AnnotationTool; label: string; icon: React.ReactNode }[] = [
  { id: "select", label: "选择", icon: <MousePointer2/> }, { id: "highlight", label: "高亮", icon: <Highlighter/> },
  { id: "pen", label: "画笔", icon: <PenLine/> }, { id: "rectangle", label: "矩形", icon: <RectangleHorizontal/> },
  { id: "ellipse", label: "圆", icon: <Circle/> }, { id: "arrow", label: "箭头", icon: <ArrowUpRight/> },
  { id: "text", label: "文字", icon: <Type/> }, { id: "eraser", label: "橡皮擦", icon: <Eraser/> },
];
type Drag = { start: NormalizedPoint; points: NormalizedPoint[]; moving?: Annotation; original?: Annotation };

export function AnnotationLayer({ weekId, pageNumber, enabled, toolbarHost, transcriptStartMs }: { weekId: string; pageNumber: number; enabled: boolean; toolbarHost: HTMLElement | null; transcriptStartMs: number | null }) {
  const [items, setItems] = useState<Annotation[]>([]);
  const [tool, setTool] = useState<AnnotationTool>("select");
  const [color, setColor] = useState(colors[0]);
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Annotation | null>(null);
  const [history, setHistory] = useState<AnnotationHistoryEntry[]>([]); const [future, setFuture] = useState<AnnotationHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null); const [notesOpen, setNotesOpen] = useState(false); const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const drag = useRef<Drag | null>(null); const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let active = true; setSelectedId(null); setPreview(null); setHistory([]); setFuture([]);
    void window.lectureMate.listAnnotations(weekId, pageNumber).then((result) => { if (!active) return; if (result.ok) setItems(result.value); else setError(result.error.message); }).catch(() => { if (active) setError("标注加载失败，请重试"); });
    return () => { active = false; };
  }, [weekId, pageNumber]);
  useEffect(() => { void window.lectureMate.getSettings().then((result) => { if (!result.ok) return; setTool(result.value.annotationTool); setColor(result.value.annotationColor); setStrokeWidth(result.value.annotationStrokeWidth); setPreferencesLoaded(true); }); }, []);
  useEffect(() => { if (preferencesLoaded) void window.lectureMate.updateSettings({ annotationTool: tool, annotationColor: color, annotationStrokeWidth: strokeWidth }); }, [tool, color, strokeWidth, preferencesLoaded]);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (!enabled) return; if (event.key === "Escape") { setSelectedId(null); setTool("select"); } if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) void redo(); else void undo(); } if ((event.key === "Backspace" || event.key === "Delete") && selectedId) { event.preventDefault(); void erase(selectedId); } }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); });
  useEffect(()=>{if(!enabled){setSelectedId(null);setPreview(null);drag.current=null;}},[enabled]);

  const updateItems = (annotation: Annotation) => setItems((current) => current.some((item) => item.id === annotation.id) ? current.map((item) => item.id === annotation.id ? annotation : item) : [...current, annotation]);
  const persist = async (before: Annotation | null, after: Annotation | null, record = true): Promise<boolean> => {
    setError(null);
    if (after) { updateItems(after); const result = await window.lectureMate.saveAnnotation(after); if (!result.ok) { setError(result.error.message); if (before) updateItems(before); else setItems((current) => current.filter((item) => item.id !== after.id)); return false; } updateItems(result.value); }
    else if (before) { setItems((current) => current.filter((item) => item.id !== before.id)); const result = await window.lectureMate.deleteAnnotation(before.id); if (!result.ok) { setError(result.error.message); setItems((current) => [...current, before]); return false; } }
    if (record) { setHistory((current) => [...current, { before, after }]); setFuture([]); }
    return true;
  };
  const undo = async () => { const transition = takeUndo(history, future); if (!transition) return; if (await persist(transition.entry.after, transition.entry.before, false)) { setHistory(transition.history); setFuture(transition.future); } };
  const redo = async () => { const transition = takeRedo(history, future); if (!transition) return; if (await persist(transition.entry.before, transition.entry.after, false)) { setHistory(transition.history); setFuture(transition.future); } };
  const erase = async (id: string) => { const item = items.find((entry) => entry.id === id); if (item) { setSelectedId(null); await persist(item, null); } };
  const pointAt = (event: React.PointerEvent<SVGSVGElement>) => { const rect = event.currentTarget.getBoundingClientRect(); return normalizePoint(event.clientX, event.clientY, rect); };
  const base = (): Omit<Annotation, "type"> => ({ id: crypto.randomUUID(), weekId, pageNumber, color, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Omit<Annotation, "type">);
  const createPreview = (start: NormalizedPoint, end: NormalizedPoint, points: NormalizedPoint[]): Annotation | null => {
    if (tool === "pen") return { ...base(), type: "pen", points, strokeWidth } as PenAnnotation;
    if (["highlight", "rectangle", "ellipse"].includes(tool)) return { ...base(), type: tool as BoxAnnotation["type"], ...normalizedBox(start, end), strokeWidth } as BoxAnnotation;
    if (tool === "arrow") return { ...base(), type: "arrow", startX: start.x, startY: start.y, endX: end.x, endY: end.y, strokeWidth } as ArrowAnnotation;
    return null;
  };
  const onDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!enabled || event.button !== 0) return; const start = pointAt(event);
    if (tool === "text") { const text = window.prompt("输入文字批注："); if (text?.trim()) void persist(null, { ...base(), type: "text", x: start.x, y: start.y, text: text.trim(), strokeWidth } as TextAnnotation); return; }
    if (tool === "select" || tool === "eraser") { setSelectedId(null); return; }
    event.currentTarget.setPointerCapture(event.pointerId); drag.current = { start, points: [start] };
  };
  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const current = drag.current; if (!current) return; const point = pointAt(event);
    if (current.moving && current.original) { const changed = translate(current.original, point.x - current.start.x, point.y - current.start.y); setItems((old) => old.map((item) => item.id === changed.id ? changed : item)); return; }
    if (tool === "pen") { const last = current.points.at(-1)!; if (Math.hypot(point.x - last.x, point.y - last.y) > .003) current.points.push(point); }
    setPreview(createPreview(current.start, point, current.points));
  };
  const onUp = (event: React.PointerEvent<SVGSVGElement>) => {
    const current = drag.current; if (!current) return; drag.current = null; setPreview(null);
    if (current.moving && current.original) { const updated = items.find((item) => item.id === current.original!.id); if (updated) void persist(current.original, updated); return; }
    const final = createPreview(current.start, pointAt(event), current.points); if (final && (final.type === "pen" ? final.points.length > 1 : true)) void persist(null, final);
  };
  const onItemDown = (event: React.PointerEvent<SVGElement>, item: Annotation) => {
    if (!enabled) return; event.stopPropagation(); if (tool === "eraser") { void erase(item.id); return; } if (tool !== "select") return;
    setSelectedId(item.id); const rect = svgRef.current?.getBoundingClientRect(); if (!rect) return;
    const start = normalizePoint(event.clientX, event.clientY, rect); drag.current = { start, points: [], moving: item, original: structuredClone(item) as Annotation }; (event.currentTarget as SVGElement).setPointerCapture?.(event.pointerId);
  };
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const changeColor = (next: string) => { setColor(next); if (selected) void persist(selected, { ...selected, color: next, updatedAt: new Date().toISOString() } as Annotation); };
  const editText = (target = selected) => { if (!target || target.type !== "text") return; const text = window.prompt("编辑文字批注：", target.text); if (text !== null && text.trim()) void persist(target, { ...target, text: text.trim(), updatedAt: new Date().toISOString() }); };
  const toolbar = <div className="annotation-toolbar"><div className="annotation-tools">{tools.map((item) => <button title={item.label} className={tool === item.id ? "active" : ""} onClick={() => setTool(item.id)} key={item.id}>{item.icon}</button>)}<button disabled={!history.length} title="撤销" onClick={() => void undo()}><Undo2/></button><button disabled={!future.length} title="重做" onClick={() => void redo()}><Redo2/></button><button title="笔记" onClick={() => setNotesOpen(true)}><StickyNote/></button></div><div className="annotation-options">{colors.map((item) => <button className={`color ${color === item ? "active" : ""}`} style={{ background: item }} onClick={() => changeColor(item)} key={item}/>) }<input aria-label="线宽" type="range" min="1" max="6" value={strokeWidth} onChange={(event) => setStrokeWidth(Number(event.target.value))}/>{selected?.type === "text" && <button onClick={() => editText()}>编辑文字</button>}{selected && <button className="delete" onClick={() => void erase(selected.id)}><Trash2/> 删除</button>}</div></div>;
  return <div className={`annotation-layer ${enabled?"editable":"readonly"}`}><svg ref={svgRef} viewBox="0 0 1 1" preserveAspectRatio="none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; setPreview(null); }}><defs><marker id="annotation-arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 Z" fill="context-stroke"/></marker></defs>{items.map((item) => <AnnotationShape item={item} selected={enabled&&item.id === selectedId} onPointerDown={onItemDown} onDoubleClick={editText} key={item.id}/>) }{enabled&&preview && <AnnotationShape item={preview} selected={false} onPointerDown={() => undefined} />}</svg>{enabled&&(toolbarHost ? createPortal(toolbar, toolbarHost) : toolbar)}{error && <div className="annotation-error">{error}</div>}{enabled&&notesOpen && <NotesPanel weekId={weekId} pageNumber={pageNumber} annotationId={selectedId} transcriptStartMs={transcriptStartMs} onClose={() => setNotesOpen(false)}/>}</div>;
}

function AnnotationShape({ item, selected, onPointerDown, onDoubleClick }: { item: Annotation; selected: boolean; onPointerDown: (event: React.PointerEvent<SVGElement>, item: Annotation) => void; onDoubleClick?: (item: Annotation) => void }) {
  const common = { onPointerDown: (event: React.PointerEvent<SVGElement>) => onPointerDown(event, item), onDoubleClick: () => onDoubleClick?.(item), className: selected ? "selected" : "", stroke: item.color, vectorEffect: "non-scaling-stroke" as const };
  if (item.type === "pen") return <polyline {...common} points={item.points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" strokeWidth={item.strokeWidth} strokeLinecap="round" strokeLinejoin="round"/>;
  if (item.type === "arrow") return <line {...common} x1={item.startX} y1={item.startY} x2={item.endX} y2={item.endY} strokeWidth={item.strokeWidth} markerEnd="url(#annotation-arrowhead)"/>;
  if (item.type === "text") return <text {...common} x={item.x} y={item.y} fill={item.color} stroke="none" fontSize=".035" className={selected ? "selected annotation-text" : "annotation-text"}>{item.text}</text>;
  if (item.type === "ellipse") return <ellipse {...common} cx={item.x + item.width / 2} cy={item.y + item.height / 2} rx={item.width / 2} ry={item.height / 2} fill="transparent" strokeWidth={item.strokeWidth}/>;
  return <rect {...common} x={item.x} y={item.y} width={item.width} height={item.height} fill={item.type === "highlight" ? item.color : "transparent"} fillOpacity={item.type === "highlight" ? .28 : 0} strokeWidth={item.strokeWidth}/>;
}

function translate(item: Annotation, dx: number, dy: number): Annotation {
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  if (item.type === "pen") return { ...item, points: item.points.map((point) => ({ x: clamp(point.x + dx), y: clamp(point.y + dy) })), updatedAt: new Date().toISOString() };
  if (item.type === "arrow") return { ...item, startX: clamp(item.startX + dx), startY: clamp(item.startY + dy), endX: clamp(item.endX + dx), endY: clamp(item.endY + dy), updatedAt: new Date().toISOString() };
  if (item.type === "text") return { ...item, x: clamp(item.x + dx), y: clamp(item.y + dy), updatedAt: new Date().toISOString() };
  return { ...item, x: clamp(item.x + dx), y: clamp(item.y + dy), updatedAt: new Date().toISOString() };
}

function NotesPanel({ weekId, pageNumber, annotationId, transcriptStartMs, onClose }: { weekId: string; pageNumber: number; annotationId: string | null; transcriptStartMs: number | null; onClose: () => void }) {
  const [notes, setNotes] = useState<Note[]>([]); const [kind, setKind] = useState<NoteKind>("page"); const [content, setContent] = useState(""); const [error, setError] = useState<string | null>(null);
  const refresh = async () => { const result = await window.lectureMate.listNotes(weekId); if (result.ok) setNotes(result.value); else setError(result.error.message); };
  useEffect(() => { void window.lectureMate.listNotes(weekId).then((result) => { if (result.ok) setNotes(result.value); else setError(result.error.message); }); }, [weekId]);
  const save = async () => { const result = await window.lectureMate.saveNote({ weekId, kind, content, pdfPage: kind === "page" ? pageNumber : undefined, transcriptStartMs: kind === "transcript" ? transcriptStartMs ?? undefined : undefined, annotationId: kind === "annotation" ? annotationId ?? undefined : undefined }); if (!result.ok) return setError(result.error.message); setContent(""); await refresh(); };
  const update = async (note: Note, next: string) => { if (next.trim() === note.content) return; const result = await window.lectureMate.saveNote({ id: note.id, courseId: note.courseId, weekId: note.weekId, kind: note.kind, content: next, pdfPage: note.pdfPage, transcriptStartMs: note.transcriptStartMs, annotationId: note.annotationId }); if (!result.ok) setError(result.error.message); else await refresh(); };
  const associationReady = kind !== "annotation" || annotationId !== null;
  return <aside className="notes-panel"><header><strong>笔记</strong><button onClick={onClose}><X/></button></header><div className="note-compose"><select value={kind} onChange={(event) => setKind(event.target.value as NoteKind)}><option value="week">周次笔记</option><option value="page">页面笔记</option><option value="transcript">字幕笔记</option><option value="annotation">标注笔记</option></select>{kind === "transcript" && transcriptStartMs === null && <small>请先在字幕面板选择一条字幕。</small>}{kind === "annotation" && !annotationId && <small>请先使用选择工具选中一个标注。</small>}<textarea value={content} placeholder="写下你的笔记…" onChange={(event) => setContent(event.target.value)}/><button className="primary" disabled={!content.trim() || !associationReady || (kind === "transcript" && transcriptStartMs === null)} onClick={() => void save()}>保存笔记</button></div>{error && <p className="note-error">{error}</p>}<div className="notes-list">{notes.map((note) => <article key={note.id}><small>{note.kind === "page" ? `第 ${note.pdfPage} 页` : note.kind === "week" ? "周次" : note.kind === "annotation" ? "标注" : `字幕 ${note.transcriptStartMs ?? ""}`}</small><textarea defaultValue={note.content} onBlur={(event) => void update(note, event.currentTarget.value)}/><button onClick={() => void window.lectureMate.deleteNote(note.id).then(() => refresh())}>删除</button></article>)}</div></aside>;
}
