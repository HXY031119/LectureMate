import { normalizeProviderError } from "./core";

export interface AIConnectionResult { ok: boolean }
export interface TranslationRequest { text: string; previousTail?: string }
export interface TranslationResult { translatedText: string }
export interface StructuredGenerationRequest { system: string; prompt: string; signal?: AbortSignal; maxTokens?: number; timeoutMs?: number }
export interface AIProvider { testConnection(): Promise<AIConnectionResult>; translate(request: TranslationRequest): Promise<TranslationResult>; generateStructured<T>(request: StructuredGenerationRequest): Promise<T> }

export const isInvalidTranslation=(value:string):boolean=>/^\s*(?:user\s+safety|safety\s+(?:classification|assessment|rating))\s*:\s*(?:safe|unsafe|allowed|blocked)\s*[.!]?\s*$/i.test(value);

export function parseStructuredJson<T>(raw: string): T {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(cleaned) as T; } catch { /* extract the first balanced JSON object below */ }
  const start = cleaned.indexOf("{"); if (start < 0) throw new Error("AI 返回内容中没有 JSON 对象");
  let depth = 0; let quoted = false; let escaped = false;
  for (let index = start; index < cleaned.length; index++) {
    const char = cleaned[index];
    if (quoted) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') { quoted = true; continue; }
    if (char === "{") depth++; else if (char === "}") { depth--; if (depth === 0) return JSON.parse(cleaned.slice(start, index + 1)) as T; }
  }
  throw new Error("AI 返回的 JSON 不完整");
}

export class OpenRouterProvider implements AIProvider {
  constructor(private readonly apiKey: string, private readonly model: string, private readonly baseUrl: string, private readonly routing: "default" | "latency" | "throughput" = "default") {}
  private async complete(messages: { role: "system" | "user"; content: string }[], json = false, externalSignal?: AbortSignal, maxTokens?: number, timeoutMs = 90_000): Promise<string> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, { method: "POST", signal, headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", "HTTP-Referer": "https://lecturemate.local", "X-Title": "LectureMate" }, body: JSON.stringify({ model: this.model, messages, temperature: 0.1, max_tokens: maxTokens ?? (json ? 8000 : 4000), ...(json ? { response_format: { type: "json_object" }, reasoning: { effort: "minimal", exclude: true } } : {}), ...(this.routing === "default" ? {} : { provider: { sort: this.routing } }) }) });
      if (!response.ok) throw new Error(`${response.status} ${await response.text()}`); const data = await response.json() as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content; if (!content) throw new Error("AI 返回内容为空"); return content;
    } catch (error) { throw normalizeProviderError(error); } finally { clearTimeout(timer); }
  }
  async testConnection(): Promise<AIConnectionResult> { await this.complete([{ role: "user", content: "Reply only OK." }]); return { ok: true }; }
  async translate(request: TranslationRequest): Promise<TranslationResult> { const messages:{role:"system"|"user";content:string}[]=[{ role: "system", content: "你是忠实的课堂字幕翻译器。把给定英文课堂字幕完整翻译成简体中文，保持顺序、段落和全部信息；不得总结、改写或补充事实。MIMO、OFDM、QPSK、BER、SNR、CSI、5G、6G 等技术缩写保留英文。只输出译文正文，绝不能输出安全分类、审核标签、角色名称或处理过程。上下文仅帮助理解，不要重复翻译上下文。" }, { role: "user", content: `${request.previousTail ? `前文上下文（不要输出）：\n${request.previousTail}\n\n` : ""}待翻译正文：\n${request.text}` }];let translatedText=(await this.complete(messages)).trim();if(isInvalidTranslation(translatedText))translatedText=(await this.complete([...messages,{role:"user",content:"上一次回答误输出了安全分类。请重新翻译，只输出简体中文译文正文。"}])).trim();if(isInvalidTranslation(translatedText))throw new Error("AI 返回了安全分类而不是译文，请再次点击翻译或更换模型");return { translatedText }; }
  async generateStructured<T>(request: StructuredGenerationRequest): Promise<T> {
    let raw: string; try { raw = await this.complete([{ role: "system", content: request.system }, { role: "user", content: request.prompt }], true, request.signal, request.maxTokens, request.timeoutMs); } catch (error) { if (!(error instanceof Error) || !error.message.includes("返回内容为空")) throw error; raw = await this.complete([{ role: "system", content: request.system }, { role: "user", content: `${request.prompt}\n\nImportant: return a non-empty JSON object.` }], true, request.signal, request.maxTokens, request.timeoutMs); }
    try { return parseStructuredJson<T>(raw); } catch {
      const repair = await this.complete([{ role: "system", content: "你是 JSON 格式修复器。把用户提供的内容转换为一个语法有效的 JSON 对象。不得解释，不得使用 Markdown，不得删减已有信息，只输出 JSON。" }, { role: "user", content: raw.slice(0, 60_000) }], true, request.signal, request.maxTokens, request.timeoutMs);
      try { return parseStructuredJson<T>(repair); } catch { throw new Error("AI 两次返回的结构化内容都无法解析，请更换模型后重试"); }
    }
  }
}
