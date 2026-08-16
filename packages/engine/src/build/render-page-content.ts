import type { int32 } from "@tsonic/core/types.js";
import { MarkdownBatchResult } from "@tsonic/rust/crates/tsumo_platform/index.js";
import { BuildEnvironment } from "../env.js";
import { renderMarkdownWithShortcodes } from "../markdown.js";
import { createMarkdownBatch } from "../markdown/platform.js";
import { MarkdownResult } from "../markdown/result.js";
import { HtmlString } from "../utils/html.js";
import { PageContext } from "../models.js";
import { StandardPageGraph } from "./standard-page-graph.js";

const applyMarkdownResult = (page: PageContext, rendered: MarkdownResult): void => {
  page.content = new HtmlString(rendered.html);
  page.summary = new HtmlString(rendered.summaryHtml);
  page.tableOfContents = new HtmlString(rendered.tableOfContents);
  page.plain = rendered.plainText;
};

const applyMarkdownBatchResult = (page: PageContext, rendered: MarkdownBatchResult): void => {
  page.content = new HtmlString(rendered.html);
  page.summary = new HtmlString(rendered.summary_html);
  page.tableOfContents = new HtmlString(rendered.table_of_contents);
  page.plain = rendered.plain_text;
};

export const renderStandardPageContent = (
  graph: StandardPageGraph,
  environment: BuildEnvironment,
): void => {
  const hasRenderHooks = environment.getRenderHookTemplate("render-link") !== undefined ||
    environment.getRenderHookTemplate("render-image") !== undefined ||
    environment.getRenderHookTemplate("render-heading") !== undefined;
  const batch = createMarkdownBatch();
  const batchedPages: PageContext[] = [];
  const batchedIndexes: int32[] = [];
  for (const entry of graph.rawBodyByPage.entries()) {
    const page = entry[0];
    const rawBody = entry[1];
    if (rawBody === "") continue;
    if (!hasRenderHooks && page.shortcodeNames.size === 0) {
      batchedPages.push(page);
      batchedIndexes.push(batch.add_source(rawBody));
      continue;
    }
    const rendered = renderMarkdownWithShortcodes(rawBody, page, graph.site, environment);
    applyMarkdownResult(page, rendered);
  }
  if (batchedPages.length === 0) return;
  batch.render();
  for (let index = 0; index < batchedPages.length; index++) {
    applyMarkdownBatchResult(batchedPages[index]!, batch.take_result(batchedIndexes[index]!));
  }
};
