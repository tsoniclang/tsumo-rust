import type { int32 as int } from "@tsonic/core/types.js";
import { MarkdownResult, renderMarkdownPlainText } from "../markdown.js";
import { createMarkdownDocument } from "../markdown/platform.js";
import { createTsumoError } from "../diagnostics.js";
import { DocsMountConfig } from "./models.js";
import { indexOfText, indexOfTextIgnoreCase, replaceLineEndings, substringCount, substringFrom, trimEndChar, trimStartChar } from "../utils/strings.js";
import { splitUrlSuffix } from "./url.js";

export class DocsLinkRewriteContext {
  mount: DocsMountConfig;
  sourcePath: string;
  currentDirKey: string;
  relPermalinkByRelPathLower: Map<string, string>;
  strictLinks: boolean;

  constructor(
    mount: DocsMountConfig,
    sourcePath: string,
    currentDirKey: string,
    relPermalinkByRelPathLower: Map<string, string>,
    strictLinks: boolean,
  ) {
    this.mount = mount;
    this.sourcePath = sourcePath;
    this.currentDirKey = currentDirKey;
    this.relPermalinkByRelPathLower = relPermalinkByRelPathLower;
    this.strictLinks = strictLinks;
  }
}

const normalizeSlashes = (path: string): string => path.replaceAll("\\", "/");

const isExternalUrl = (url: string): boolean => {
  const lower = url.trim().toLowerCase();
  return (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("tel:") ||
    lower.startsWith("//")
  );
};

const isUnsafeUrl = (url: string): boolean => {
  const lower = url.trim().toLowerCase();
  return lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("vbscript:");
};

const isMarkdownLink = (path: string): boolean => {
  const lower = path.trim().toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
};

const normalizeRelativePath = (baseDirKey: string, targetPath: string): string | undefined => {
  const base = baseDirKey.trim();
  const start: string[] = [];
  if (base !== "") {
    const baseParts = base.split("/");
    for (let i = 0; i < baseParts.length; i++) {
      const seg = baseParts[i]!.trim();
      if (seg !== "") start.push(seg);
    }
  }

  const target = normalizeSlashes(targetPath.trim());
  const parts = target.split("/");

  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i]!;
    const seg = raw.trim();
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (start.length === 0) return undefined;
      start.pop();
      continue;
    }
    start.push(seg);
  }

  const arr = start;
  if (arr.length === 0) return "";
  let out = arr[0]!;
  for (let i = 1; i < arr.length; i++) out += "/" + arr[i]!;
  return out;
};

const computeGitHubBlobUrl = (mount: DocsMountConfig, repoRelPath: string): string | undefined => {
  const repoUrl = mount.repoUrl;
  if (repoUrl === undefined) return undefined;
  const slash = "/";
  const repo = trimEndChar(repoUrl.trim(), slash);
  if (repo === "") return undefined;
  const branch = mount.repoBranch.trim() === "" ? "main" : mount.repoBranch.trim();
  const rel = trimStartChar(repoRelPath.trim(), slash);
  if (rel === "") return undefined;
  return `${repo}/blob/${branch}/${rel}`;
};

const maybeRewriteUrl = (urlValue: string, ctx: DocsLinkRewriteContext): string | undefined => {
  const url = urlValue.trim();
  if (isUnsafeUrl(url)) {
    throw createTsumoError("TSUMO_DOCS_LINK_UNSAFE", `Unsafe docs link: ${url}`, ctx.sourcePath);
  }
  if (url === "" || url.startsWith("#") || isExternalUrl(url)) return undefined;

  const split = splitUrlSuffix(url);
  const pathPart = split.path.trim();
  const suffix = split.suffix;
  if (pathPart === "") return undefined;

  const slash = "/";

  const mountPrefixLower = ctx.mount.urlPrefix.toLowerCase();
  const pathLower = pathPart.toLowerCase();

  let resolvedRel: string | undefined = undefined;
  let escaped = false;

  if (pathPart.startsWith("/")) {
    // Only rewrite site-absolute paths that are within the mount prefix.
    if (mountPrefixLower === "/") {
      resolvedRel = trimStartChar(pathPart, slash);
    } else if (pathLower.startsWith(mountPrefixLower)) {
      resolvedRel = trimStartChar(substringFrom(pathPart, ctx.mount.urlPrefix.length), slash);
    } else {
      return undefined;
    }
  } else {
    resolvedRel = normalizeRelativePath(ctx.currentDirKey, pathPart);
    escaped = resolvedRel === undefined;
  }

  if (escaped) {
    if (ctx.strictLinks) {
      throw createTsumoError(
        "TSUMO_DOCS_LINK_ESCAPES_MOUNT",
        `Out-of-mount link from ${ctx.mount.name}: ${url}`,
        ctx.sourcePath,
      );
    }

    // Repository metadata defines the explicit fallback for links outside the mounted source root.
    const repoPathRaw = ctx.mount.repoPath;
    if (repoPathRaw === undefined || repoPathRaw.trim() === "") return undefined;

    const repoPath = trimEndChar(trimStartChar(repoPathRaw.trim(), slash), slash);
    const baseDir = ctx.currentDirKey.trim() === "" ? repoPath : `${repoPath}/${ctx.currentDirKey}`;
    const repoRel = normalizeRelativePath(baseDir, pathPart);
    if (repoRel === undefined) return undefined;
    const gh = computeGitHubBlobUrl(ctx.mount, repoRel);
    return gh !== undefined ? gh + suffix : undefined;
  }

  if (resolvedRel === undefined) return undefined;

  // Only rewrite markdown file links to generated routes.
  if (!isMarkdownLink(resolvedRel)) return undefined;

  const key = resolvedRel.toLowerCase();
  const mapped = ctx.relPermalinkByRelPathLower.get(key);
  if (mapped !== undefined) return mapped + suffix;
  if (ctx.strictLinks) {
    throw createTsumoError(
      "TSUMO_DOCS_LINK_UNRESOLVED",
      `Unresolved docs link from ${ctx.mount.name}: ${url}`,
      ctx.sourcePath,
    );
  }
  return undefined;
};

const normalizeNewlines = (text: string): string => replaceLineEndings(text, "\n");

const summaryMarker = "<!--more-->";
const summaryMarkerLength = summaryMarker.length;

const findSummaryDividerIndex = (markdown: string): int => indexOfTextIgnoreCase(markdown, summaryMarker);

const firstBlock = (markdown: string): string => {
  const text = markdown.trim();
  if (text === "") return "";
  const idx = indexOfText(text, "\n\n");
  return idx >= 0 ? substringCount(text, 0, idx) : text;
};

const renderWithRewrites = (markdown: string, ctx: DocsLinkRewriteContext): string => {
  const document = createMarkdownDocument(markdown);
  const count: int = document.occurrence_count();
  for (let index: int = 0; index < count; index++) {
    const occurrence = document.occurrence(index);
    if (occurrence.kind !== "link" && occurrence.kind !== "image") continue;
    const updated = maybeRewriteUrl(occurrence.destination, ctx);
    if (updated !== undefined) document.replace_url(index, updated);
  }
  return document.render();
};

export const renderDocsMarkdown = (markdownRaw: string, ctx: DocsLinkRewriteContext): MarkdownResult => {
  const markdown = normalizeNewlines(markdownRaw);
  const moreIndex = findSummaryDividerIndex(markdown);

  if (moreIndex >= 0) {
    const before = substringCount(markdown, 0, moreIndex);
    const after = substringFrom(markdown, moreIndex + summaryMarkerLength);
    const full = before + after;
    return new MarkdownResult(renderWithRewrites(full, ctx), renderWithRewrites(before, ctx).trim(), renderMarkdownPlainText(full), "");
  }

  const html = renderWithRewrites(markdown, ctx);
  const summarySource = firstBlock(markdown);
  const summaryHtml = summarySource === "" ? "" : renderWithRewrites(summarySource, ctx).trim();
  return new MarkdownResult(html, summaryHtml, renderMarkdownPlainText(markdown), "");
};
