import { MarkdownBatchResult } from "@tsonic/rust/crates/tsumo_platform/index.js";
import { MarkdownResult } from "./result.js";
import { createMarkdownBatch } from "./platform.js";

const createMarkdownResult = (result: MarkdownBatchResult): MarkdownResult => {
  return new MarkdownResult(result.html, result.summary_html, result.plain_text, result.table_of_contents);
};

export const renderMarkdown = (markdownRaw: string): MarkdownResult => {
  const batch = createMarkdownBatch();
  const index = batch.add_source(markdownRaw);
  batch.render();
  return createMarkdownResult(batch.take_result(index));
};
