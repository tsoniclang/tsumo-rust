import { renderMarkdownTableOfContents } from "./platform.js";

export const escapeHtmlText = (text: string): string => {
  let result = text;
  result = result.replaceAll("&", "&amp;");
  result = result.replaceAll("<", "&lt;");
  result = result.replaceAll(">", "&gt;");
  result = result.replaceAll("\"", "&quot;");
  return result;
};

export const generateTableOfContents = (markdown: string): string =>
  renderMarkdownTableOfContents(markdown);
