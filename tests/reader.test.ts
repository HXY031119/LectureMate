import { describe, expect, it } from "vitest";
import { parseTranslationPages } from "../src/lib/translationParser";
import { formatTranscriptTime, parseTranscriptJson, segmentTranscript } from "../src/lib/transcript";

describe("Phase 2 阅读器解析器", () => {
  it("解析页码与等号分隔线位于同一行的格式", () => {
    expect(parseTranslationPages("文件说明：PDF 第 1–100 页\n==================== 第1页 ==================== EE6122 光纤通信\n封面\n==================== 第2页 ==================== EE6122 通知\n通知正文")).toEqual([{ pageNumber: 1, content: "EE6122 光纤通信\n封面" }, { pageNumber: 2, content: "EE6122 通知\n通知正文" }]);
  });

  it("解析 BOM、CRLF、宽松空格与缺页的中文翻译", () => {
    const pages = parseTranslationPages("\uFEFF第 1 页\r\n--------\r\n第一段\r\n\r\n第二段\r\n第3页\r\n---\r\n第三页无末尾换行");
    expect(pages).toEqual([
      { pageNumber: 1, content: "第一段\n\n第二段" },
      { pageNumber: 3, content: "第三页无末尾换行" },
    ]);
  });

  it("解析带总页数和等号分隔线的真实翻译格式", () => {
    const pages = parseTranslationPages("========================================================================\n第 1 页 / 64\n========================================================================\n课程封面\n========================================================================\n第2页／共64页\n========================================================================\n第二页内容\n第 4 页（共 64 页）\n----\n第四页内容");
    expect(pages).toEqual([
      { pageNumber: 1, content: "课程封面" },
      { pageNumber: 2, content: "第二页内容" },
      { pageNumber: 4, content: "第四页内容" },
    ]);
  });

  it("翻译文件没有页码标记时给出中文错误", () => {
    expect(() => parseTranslationPages("普通文本")).toThrow("没有找到");
  });

  it("校验并保留逐词 JSON 原始字段", () => {
    const words = parseTranscriptJson('[{"i":1,"w":"Okay.","s":22660,"e":22700,"t":"word","a":59}]');
    expect(words[0]).toMatchObject({ index: 1, text: "Okay.", startMs: 22660, endMs: 22700, raw: { a: 59 } });
    expect(() => parseTranscriptJson('[{"i":1,"w":"bad"}]')).toThrow("缺少必要字段");
    expect(() => parseTranscriptJson("not json")).toThrow("格式不正确");
  });

  it("综合句末、长间隔和时长进行字幕分段", () => {
    const words = parseTranscriptJson(JSON.stringify([
      { i: 1, w: "Today", s: 0, e: 300 }, { i: 2, w: "we begin.", s: 350, e: 900 },
      { i: 3, w: "Important", s: 3000, e: 3400 }, { i: 4, w: "idea", s: 3450, e: 3900 },
    ]));
    const segments = segmentTranscript(words);
    expect(segments.map((segment) => segment.text)).toEqual(["Today we begin.", "Important idea"]);
    expect(segments[0].words).toHaveLength(2);
  });

  it("统一格式化不足一小时和超过一小时的时间", () => {
    expect(formatTranscriptTime(754_000)).toBe("12:34");
    expect(formatTranscriptTime(3_754_000)).toBe("01:02:34");
    expect(formatTranscriptTime(-100)).toBe("00:00");
  });
});
