import { MarkdownDocument } from "@tsonic/rust/crates/tsumo_platform/index.js";

export const createMarkdownDocument = (source: string): MarkdownDocument =>
  new MarkdownDocument(source);

export const renderMarkdownHtml = (source: string): string =>
  createMarkdownDocument(source).render();

export const renderMarkdownPlainText = (source: string): string =>
  createMarkdownDocument(source).plain_text();

export const renderMarkdownTableOfContents = (source: string): string =>
  createMarkdownDocument(source).table_of_contents();
