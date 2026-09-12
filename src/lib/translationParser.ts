import type { TranslationPage } from "../../shared/domain";

export function parseTranslationPages(input: string): TranslationPage[] {
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const marker = /^[\t ]*(?:[=\-_—]{3,}[\t ]*)?第[\t ]*(\d+)[\t ]*页(?:[\t ]*(?:\/|／)[\t ]*(?:共[\t ]*)?\d+[\t ]*页?)?(?:[\t ]*[（(][\t ]*(?:共[\t ]*)?\d+[\t ]*页[\t ]*[）)])?(?:[\t ]*[=\-_—]{3,})?[\t ]*/gm;
  const matches = [...text.matchAll(marker)];
  if (matches.length === 0) throw new Error("中文翻译文件中没有找到“第 N 页”页码标记");
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    const content = text.slice(start, end)
      .replace(/^\s*[=\-_—]{3,}\s*\n?/, "")
      .replace(/\n?\s*[=\-_—]{3,}\s*$/, "")
      .trim();
    return { pageNumber: Number(match[1]), content };
  });
}
