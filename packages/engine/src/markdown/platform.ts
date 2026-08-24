import {
  create_markdown_source_plan,
  MarkdownBatch,
  MarkdownDocument,
} from "@tsonic/rust/crates/tsumo_platform/index.js";
import type { int32 } from "@tsonic/core/types.js";
import { MarkdownResult } from "./result.js";

export class TsumoMarkdownBatch {
  #batch: MarkdownBatch;

  constructor() {
    this.#batch = new MarkdownBatch();
  }

  addSource(source: string): int32 {
    return this.#batch.add_source(source);
  }

  render(): void {
    this.#batch.render();
  }

  takeResult(index: int32): MarkdownResult {
    const result = this.#batch.take_result(index);
    return new MarkdownResult(result.html, result.summary_html, result.plain_text, result.table_of_contents);
  }
}

export const createMarkdownBatch = (): TsumoMarkdownBatch => new TsumoMarkdownBatch();

export class TsumoMarkdownSourcePlan {
  fullSource: string;
  summarySource: string;
  tableOfContentsSource: string;

  constructor(fullSource: string, summarySource: string, tableOfContentsSource: string) {
    this.fullSource = fullSource;
    this.summarySource = summarySource;
    this.tableOfContentsSource = tableOfContentsSource;
  }
}

export class TsumoMarkdownOccurrence {
  kind: string;
  destination: string;
  plainText: string;
  title: string;
  level: int32;
  anchor: string;

  constructor(
    kind: string,
    destination: string,
    plainText: string,
    title: string,
    level: int32,
    anchor: string,
  ) {
    this.kind = kind;
    this.destination = destination;
    this.plainText = plainText;
    this.title = title;
    this.level = level;
    this.anchor = anchor;
  }
}

export class TsumoMarkdownDocument {
  #document: MarkdownDocument;

  constructor(source: string) {
    this.#document = new MarkdownDocument(source);
  }

  occurrenceCount(): int32 {
    return this.#document.occurrence_count();
  }

  occurrence(index: int32): TsumoMarkdownOccurrence {
    const occurrence = this.#document.occurrence(index);
    return new TsumoMarkdownOccurrence(
      occurrence.kind,
      occurrence.destination,
      occurrence.plain_text,
      occurrence.title,
      occurrence.level,
      occurrence.anchor,
    );
  }

  replaceUrl(index: int32, value: string): void {
    this.#document.replace_url(index, value);
  }

  occurrenceHtml(index: int32): string {
    return this.#document.occurrence_html(index);
  }

  replaceHtml(index: int32, value: string): void {
    this.#document.replace_html(index, value);
  }

  render(): string {
    return this.#document.render();
  }

  plainText(): string {
    return this.#document.plain_text();
  }

  tableOfContents(): string {
    return this.#document.table_of_contents();
  }
}

export const createMarkdownSourcePlan = (source: string): TsumoMarkdownSourcePlan => {
  const plan = create_markdown_source_plan(source);
  return new TsumoMarkdownSourcePlan(plan.full_source, plan.summary_source, plan.toc_source);
};

export const createMarkdownDocument = (source: string): TsumoMarkdownDocument =>
  new TsumoMarkdownDocument(source);

export const renderMarkdownHtml = (source: string): string =>
  createMarkdownDocument(source).render();

export const renderMarkdownPlainText = (source: string): string =>
  createMarkdownDocument(source).plainText();

export const renderMarkdownTableOfContents = (source: string): string =>
  createMarkdownDocument(source).tableOfContents();
