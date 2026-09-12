import type { Evidence } from "../../shared/domain";
import type { StudyNoteItem, WeekStudyNotes } from "../../shared/domain";

export interface TeacherSignals { explicitEmphasis: number; repeatedMentions: number; explanationDepth: number; examples: string[]; comparisons: string[]; warnings: string[]; assessmentMentions: string[] }
export interface MapFact { title: string; summary: string; evidence: Evidence[]; explicit?: boolean; expression?: string; meaning?: string; variables?: string[]; confidence?: number; context?: string; teacherSignals?: TeacherSignals }
export interface MapAnalysis { concepts: MapFact[]; teacherEmphasis: MapFact[]; lectureAdditions: MapFact[]; assessmentInfo: MapFact[]; formulas: MapFact[] }
const keys = ["concepts", "teacherEmphasis", "lectureAdditions", "assessmentInfo", "formulas"] as const;

export function validateMapAnalysis(value: unknown, defaultSource: "pdf" | "transcript" = "transcript"): MapAnalysis {
  if (!value || typeof value !== "object") throw new Error("AI Map 结果不是对象"); const raw = value as Record<string, unknown>; const output = {} as MapAnalysis;
  for (const key of keys) {
    const list: unknown[] = Array.isArray(raw[key]) ? raw[key] : [];
    output[key] = list.flatMap<MapFact>((item) => {
      if (typeof item === "string" && item.trim()) return [{ title: item.trim(), summary: item.trim(), evidence: [] }];
      if (!item || typeof item !== "object") return [];
      const fact = item as Record<string, unknown>;
      const title = [fact.title, fact.name, fact.concept, fact.formula, fact.statement].find((field) => typeof field === "string" && field.trim()) as string | undefined;
      if (!title) return [];
      const summary = [fact.summary, fact.explanationSummary, fact.meaning, fact.description, fact.explanation, fact.context, fact.text, title].find((field) => typeof field === "string") as string;
      const rawEvidence = Array.isArray(fact.evidence) ? fact.evidence : Array.isArray(fact.transcriptEvidence)?fact.transcriptEvidence:[];
      const normalizedEvidence = rawEvidence.flatMap((entry): Evidence[] => {
        if (typeof entry === "string" && entry.trim()) return [{ source: defaultSource, text: entry.trim() }];
        if (!entry || typeof entry !== "object") return [];
        const evidence = entry as Record<string, unknown>;
        const text = [evidence.text, evidence.quote, evidence.transcriptText].find((field) => typeof field === "string" && field.trim()) as string | undefined;
        if (!text) return [];
        const source = evidence.source === "pdf" || evidence.source === "transcript" ? evidence.source : defaultSource;
        return [{ source, text, ...(Number.isInteger(evidence.pageNumber) ? { pageNumber: evidence.pageNumber as number } : {}) }];
      });
      if(key==="formulas" && Number.isInteger(fact.pageNumber) && !normalizedEvidence.some(e=>e.pageNumber===fact.pageNumber)) normalizedEvidence.push({source:"pdf",text:typeof fact.context==="string"?fact.context:summary,pageNumber:fact.pageNumber as number});
      const strings=(name:string)=>Array.isArray(fact[name])?fact[name].filter((v):v is string=>typeof v==="string"&&Boolean(v.trim())):[];
      const count=(name:string,max:number)=>Math.max(0,Math.min(max,Number(fact[name])||0));
      const teacherSignals=defaultSource==="transcript"&&key==="teacherEmphasis"?{explicitEmphasis:count("explicitEmphasis",3),repeatedMentions:count("repeatedMentions",3),explanationDepth:count("explanationDepth",3),examples:strings("examples"),comparisons:strings("comparisons"),warnings:strings("warnings"),assessmentMentions:strings("assessmentMentions")} : undefined;
      return [{ title, summary, explicit: fact.explicit === true, evidence: normalizedEvidence, ...(teacherSignals?{teacherSignals}:{}), ...(typeof fact.expression==="string"?{expression:fact.expression}:{}), ...(typeof fact.meaning==="string"?{meaning:fact.meaning}:{}), ...(Array.isArray(fact.variables)?{variables:fact.variables.filter((v):v is string=>typeof v==="string")} : {}), ...(typeof fact.confidence==="number"?{confidence:Math.max(0,Math.min(1,fact.confidence))}:{}), ...(typeof fact.context==="string"?{context:fact.context}:{}) }];
    }) as never;
  }
  return output;
}

export function mergeMapAnalyses(values: MapAnalysis[]): MapAnalysis {
  const output = Object.fromEntries(keys.map((key) => [key, []])) as unknown as MapAnalysis;
  for (const key of keys) { const seen = new Map<string, MapFact>(); for (const value of values) for (const item of value[key]) { const id = (key==="formulas" && item.expression ? item.expression.replace(/\s+/g,"") : key==="teacherEmphasis"?item.title:item.title+"|"+item.summary).toLocaleLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g,""); const previous = seen.get(id); if (previous) { previous.evidence.push(...item.evidence.filter((e) => !previous.evidence.some((p) => p.source === e.source && p.pageNumber === e.pageNumber && p.text === e.text && p.lectureSessionId===e.lectureSessionId))); if(previous.teacherSignals&&item.teacherSignals){previous.teacherSignals.explicitEmphasis=Math.min(3,previous.teacherSignals.explicitEmphasis+item.teacherSignals.explicitEmphasis);previous.teacherSignals.repeatedMentions=Math.min(3,previous.teacherSignals.repeatedMentions+item.teacherSignals.repeatedMentions);previous.teacherSignals.explanationDepth=Math.max(previous.teacherSignals.explanationDepth,item.teacherSignals.explanationDepth);for(const field of ["examples","comparisons","warnings","assessmentMentions"] as const)previous.teacherSignals[field]=[...new Set([...previous.teacherSignals[field],...item.teacherSignals[field]])];}} else seen.set(id, { ...item, evidence: [...item.evidence],teacherSignals:item.teacherSignals?{...item.teacherSignals,examples:[...item.teacherSignals.examples],comparisons:[...item.teacherSignals.comparisons],warnings:[...item.teacherSignals.warnings],assessmentMentions:[...item.teacherSignals.assessmentMentions]}:undefined }); } output[key] = [...seen.values()]; }
  return output;
}

export function scoreTeacherEmphasis(fact:MapFact):{importance:number;reasons:string[]}{
  const s=fact.teacherSignals??{explicitEmphasis:0,repeatedMentions:0,explanationDepth:0,examples:[],comparisons:[],warnings:[],assessmentMentions:[]};
  const lectures=new Set(fact.evidence.filter(e=>e.source==="transcript").map(e=>e.lectureSessionId).filter(Boolean));
  const score=s.explicitEmphasis*3+s.repeatedMentions*2+s.explanationDepth*2+Math.min(2,s.examples.length)*1.5+Math.min(2,s.comparisons.length+s.warnings.length)*1.5+Math.min(3,s.assessmentMentions.length)*3+Math.max(0,lectures.size-1)*3;
  const reasons:string[]=[]; if(lectures.size>1)reasons.push(`${lectures.size} 节课均有讲解`); if(s.explicitEmphasis)reasons.push("老师有明确强调"); if(s.repeatedMentions)reasons.push("课堂中反复讲解"); if(s.explanationDepth>=2)reasons.push("老师进行了较深入解释"); if(s.examples.length)reasons.push(`提供 ${s.examples.length} 个课堂例子`); if(s.comparisons.length+s.warnings.length)reasons.push("包含对比或易混淆提醒"); if(s.assessmentMentions.length)reasons.push("老师明确关联考试或 Quiz");
  return {importance:Math.max(1,Math.min(5,Math.ceil(score/5))),reasons};
}

export function backfillEmptyStudyNoteSections(content:WeekStudyNotes,mapped:MapAnalysis):WeekStudyNotes {
  const item=(fact:MapFact):StudyNoteItem=>({title:fact.title,summary:fact.summary,evidence:fact.evidence,confidence:fact.confidence,expression:fact.expression,meaning:fact.meaning,variables:fact.variables});
  const teacher=mapped.teacherEmphasis.filter(fact=>fact.evidence.some(e=>e.source==="transcript")).map(fact=>{const scored=scoreTeacherEmphasis(fact);return {...item(fact),importance:scored.importance,reasons:scored.reasons,emphasisType:fact.teacherSignals?.explicitEmphasis?"explicit":"inferred"};}).sort((a,b)=>(b.importance??0)-(a.importance??0));
  const examples=mapped.teacherEmphasis.flatMap(fact=>(fact.teacherSignals?.examples??[]).map(example=>({title:fact.title,summary:example,evidence:fact.evidence.filter(e=>e.source==="transcript")})));
  const confusing=mapped.teacherEmphasis.flatMap(fact=>[...(fact.teacherSignals?.comparisons??[]),...(fact.teacherSignals?.warnings??[])].map(summary=>({title:fact.title,summary,evidence:fact.evidence.filter(e=>e.source==="transcript")})));
  const core=mapped.concepts.map(item); const priorities=[...teacher,...core].slice(0,10);
  return {...content,coreConcepts:content.coreConcepts.length?content.coreConcepts:core,teacherEmphasis:content.teacherEmphasis.length?content.teacherEmphasis:teacher,lectureAdditions:content.lectureAdditions.length?content.lectureAdditions:mapped.lectureAdditions.map(item),confusingConcepts:content.confusingConcepts.length?content.confusingConcepts:confusing,examples:content.examples.length?content.examples:examples,assessmentInfo:content.assessmentInfo.length?content.assessmentInfo:mapped.assessmentInfo.filter(fact=>fact.evidence.some(e=>e.source==="transcript")).map(item),formulasAndDefinitions:content.formulasAndDefinitions.length?content.formulasAndDefinitions:mapped.formulas.map(item),reviewPriorities:content.reviewPriorities.length?content.reviewPriorities:priorities,finalSummary:content.finalSummary||priorities.slice(0,5).map(value=>value.summary).join("；")};
}

const factWords=(value:string)=>new Set(value.toLocaleLowerCase().match(/[a-z0-9]{3,}|[\u4e00-\u9fff]{2,}/g)??[]);
const overlap=(a:string,b:string)=>{const left=factWords(a),right=factWords(b);let score=0;for(const word of left)if(right.has(word))score++;return score;};
export function ensureMapEvidence(value:MapAnalysis,input:{stage:"pdf"|"transcript";sourceText:string;lectureSessionId?:string;lectureTitle?:string}):MapAnalysis {
  const pdfPages=[...input.sourceText.matchAll(/\[PDF page (\d+)\]\n([\s\S]*?)(?=\n\[PDF page |$)/g)].map(match=>({pageNumber:Number(match[1]),text:match[2].trim()}));
  const fallbackText=input.stage==="pdf"?(pdfPages[0]?.text??input.sourceText):input.sourceText.replace(/^\[[^\]]+\]\n/,"");
  return Object.fromEntries(keys.map(key=>[key,value[key].map(item=>{if(item.evidence.length)return input.stage==="transcript"?{...item,evidence:item.evidence.map(e=>({...e,lectureSessionId:e.lectureSessionId??input.lectureSessionId,lectureTitle:e.lectureTitle??input.lectureTitle}))}:item;let page=pdfPages[0];if(pdfPages.length>1)page=[...pdfPages].sort((a,b)=>overlap(`${item.title} ${item.summary}`,b.text)-overlap(`${item.title} ${item.summary}`,a.text))[0];const text=(page?.text??fallbackText).replace(/\s+/g," ").slice(0,420);return {...item,evidence:[{source:input.stage,text,pageNumber:input.stage==="pdf"?page?.pageNumber:undefined,lectureSessionId:input.lectureSessionId,lectureTitle:input.lectureTitle}]};})])) as unknown as MapAnalysis;
}
export function restoreStudyNoteEvidence(content:WeekStudyNotes,mapped:MapAnalysis):WeekStudyNotes {
  const facts=keys.flatMap(key=>mapped[key]); const sectionKeys=["coreConcepts","teacherEmphasis","lectureAdditions","confusingConcepts","examples","assessmentInfo","formulasAndDefinitions","reviewPriorities"] as const;
  const directPools:Partial<Record<(typeof sectionKeys)[number],MapFact[]>>={coreConcepts:mapped.concepts,teacherEmphasis:mapped.teacherEmphasis,lectureAdditions:mapped.lectureAdditions,assessmentInfo:mapped.assessmentInfo,formulasAndDefinitions:mapped.formulas};
  const restore=(item:StudyNoteItem,index:number,key:(typeof sectionKeys)[number]):StudyNoteItem=>{if(item.evidence?.length)return item;const pool=directPools[key]?.length?directPools[key]!:facts;const ranked=pool.map(fact=>({fact,score:overlap(`${item.title} ${item.summary}`,`${fact.title} ${fact.summary}`)})).sort((a,b)=>b.score-a.score);const match=ranked[0];const fallback=directPools[key]?.[index%directPools[key]!.length];return {...item,evidence:match&&match.score>0?match.fact.evidence:(fallback?.evidence??[])};};
  return backfillEmptyStudyNoteSections({...content,...Object.fromEntries(sectionKeys.map(key=>[key,content[key].map((item,index)=>restore(item,index,key))]))},mapped);
}

export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>, cancelled: () => boolean = () => false): Promise<R[]> {
  const results = new Array<R>(items.length); let cursor = 0;
  const run = async () => { while (!cancelled()) { const index = cursor++; if (index >= items.length) return; results[index] = await worker(items[index], index); } };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, run));
  if (cancelled()) throw new DOMException("用户取消", "AbortError"); return results;
}
