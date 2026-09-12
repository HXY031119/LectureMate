import { readFileSync } from "node:fs";
import type { LectureMateService } from "./services/lectureMateService";
import type { PdfPageContent } from "../shared/domain";

async function extractPages(path: string): Promise<PdfPageContent[]> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>;
  const { getDocument } = await dynamicImport("pdfjs-dist/legacy/build/pdf.mjs"); const document = await getDocument({ data: new Uint8Array(readFileSync(path)) }).promise; const pages: PdfPageContent[] = [];
  try { for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) { const page = await document.getPage(pageNumber); const content = await page.getTextContent(); pages.push({ pageNumber, text: content.items.map((item) => "str" in item ? item.str : "").join(" ") }); } return pages; }
  finally { await document.destroy(); }
}

export async function runPhase4Benchmark(service: LectureMateService): Promise<void> {
  const settings = service.settings.get(); if (!settings.lastWeekId) throw new Error("没有最近使用的 Week"); const pdf = service.weeks.listFiles(settings.lastWeekId).find((file) => file.kind === "pdf"); if (!pdf) throw new Error("实际 Week 没有 PDF"); const pages = await extractPages(pdf.managedPath);
  if (process.env.LECTUREMATE_FINAL_CACHE_ONLY === "1") { const started = Date.now(); await service.generateStudyNotes(settings.lastWeekId, pages, false); console.info(`[AI benchmark] week=${settings.lastWeekId} finalCacheMs=${Date.now() - started} mapCacheRows=${service.ai.countMapResults(settings.lastWeekId)}`); return; }
  if (process.env.LECTUREMATE_CLEAR_MAP_CACHE === "1") service.ai.clearMapResults(settings.lastWeekId);
  const coldStarted = Date.now(); await service.generateStudyNotes(settings.lastWeekId, pages, true); const coldMs = Date.now() - coldStarted;
  const warmStarted = Date.now(); await service.generateStudyNotes(settings.lastWeekId, pages, false); const warmMs = Date.now() - warmStarted;
  const cacheRows = service.ai.countMapResults(settings.lastWeekId);
  console.info(`[AI benchmark] week=${settings.lastWeekId} coldMs=${coldMs} warmMs=${warmMs} mapCacheRows=${cacheRows}`);
}
