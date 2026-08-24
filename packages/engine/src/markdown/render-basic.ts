import { MarkdownResult } from "./result.js";
import { createMarkdownBatch } from "./platform.js";

export const renderMarkdown = (markdownRaw: string): MarkdownResult => {
  const batch = createMarkdownBatch();
  const index = batch.addSource(markdownRaw);
  batch.render();
  return batch.takeResult(index);
};
