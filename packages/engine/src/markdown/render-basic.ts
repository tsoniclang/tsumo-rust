import type { int32 as int } from "@tsonic/core/types.js";
import { indexOfText, indexOfTextIgnoreCase, replaceLineEndings, substringCount, substringFrom } from "../utils/strings.js";
import { MarkdownResult } from "./result.js";
import { renderMarkdownHtml, renderMarkdownPlainText } from "./platform.js";
import { generateTableOfContents } from "./toc.js";

export const normalizeNewlines = (text: string): string => replaceLineEndings(text, "\n");

export const summaryMarker = "<!--more-->";
export const summaryMarkerLength = summaryMarker.length;

export const findSummaryDividerIndex = (markdown: string): int => indexOfTextIgnoreCase(markdown, summaryMarker);

export const firstBlock = (markdown: string): string => {
  const text = markdown.trim();
  if (text === "") return "";
  const idx = indexOfText(text, "\n\n");
  return idx >= 0 ? substringCount(text, 0, idx) : text;
};

export const renderMarkdown = (markdownRaw: string): MarkdownResult => {
  const markdown = normalizeNewlines(markdownRaw);
  const moreIndex = findSummaryDividerIndex(markdown);
  const toc = generateTableOfContents(markdown);

  if (moreIndex >= 0) {
    const before = substringCount(markdown, 0, moreIndex);
    const after = substringFrom(markdown, moreIndex + summaryMarkerLength);
    const full = before + after;
    return new MarkdownResult(
      renderMarkdownHtml(full),
      renderMarkdownHtml(before).trim(),
      renderMarkdownPlainText(full),
      toc,
    );
  }

  const html = renderMarkdownHtml(markdown);
  const plainText = renderMarkdownPlainText(markdown);
  const summarySource = firstBlock(markdown);
  const summaryHtml = summarySource === "" ? "" : renderMarkdownHtml(summarySource).trim();
  return new MarkdownResult(html, summaryHtml, plainText, toc);
};
