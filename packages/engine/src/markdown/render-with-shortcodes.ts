import { parseShortcodes, ShortcodeCall } from "../shortcode.js";
import { TemplateEnvironment } from "../template/environment.js";
import { PageContext, SiteContext } from "../models.js";
import { MarkdownResult } from "./result.js";
import { RenderHookContext, renderMarkdownWithHooks } from "./render-hooks.js";
import { createMarkdownDocument, createMarkdownSourcePlan } from "./platform.js";
import { createOrdinalTracker, processShortcodeCalls, renderShortcode } from "./shortcodes.js";
import { replaceLineEndings, substringCount, substringFrom } from "../utils/strings.js";

class ProtectedShortcode {
  marker: string;
  output: string;

  constructor(marker: string, output: string) {
    this.marker = marker;
    this.output = output;
  }
}

class ProtectedShortcodeSource {
  source: string;
  replacements: ProtectedShortcode[];

  constructor(source: string, replacements: ProtectedShortcode[]) {
    this.source = source;
    this.replacements = replacements;
  }
}

const protectStandardShortcodes = (
  text: string,
  calls: readonly ShortcodeCall[],
  page: PageContext,
  site: SiteContext,
  env: TemplateEnvironment,
  ordinalTracker: ReturnType<typeof createOrdinalTracker>,
  recursionGuard: Map<string, boolean>,
): ProtectedShortcodeSource => {
  const outputs: string[] = [];
  for (let i = 0; i < calls.length; i++) {
    outputs.push(renderShortcode(calls[i]!, page, site, env, ordinalTracker, undefined, recursionGuard));
  }

  let markerPrefix = "tsumo-shortcode-output";
  let markerPrefixTaken = true;
  while (markerPrefixTaken) {
    markerPrefixTaken = text.includes(`<!--${markerPrefix}-`);
    for (let i = 0; i < outputs.length && !markerPrefixTaken; i++) {
      markerPrefixTaken = outputs[i]!.includes(`<!--${markerPrefix}-`);
    }
    if (markerPrefixTaken) markerPrefix += "-x";
  }

  const replacements: ProtectedShortcode[] = [];
  for (let i = 0; i < calls.length; i++) {
    replacements.push(new ProtectedShortcode(`<!--${markerPrefix}-${i}-->`, outputs[i]!));
  }

  let source = text;
  for (let i = calls.length - 1; i >= 0; i--) {
    const call = calls[i]!;
    source = substringCount(source, 0, call.startIndex) + replacements[i]!.marker + substringFrom(source, call.endIndex);
  }

  return new ProtectedShortcodeSource(source, replacements);
};

const restoreStandardShortcodes = (html: string, replacements: readonly ProtectedShortcode[]): string => {
  let result = html;
  for (let i = 0; i < replacements.length; i++) {
    const replacement = replacements[i]!;
    result = result.replace(replacement.marker, replacement.output);
  }
  return result;
};

export const renderMarkdownWithShortcodes = (
  markdownRaw: string,
  page: PageContext,
  site: SiteContext,
  env: TemplateEnvironment,
): MarkdownResult => {
  const markdown = replaceLineEndings(markdownRaw, "\n");
  const ordinalTracker = createOrdinalTracker();
  const recursionGuard = new Map<string, boolean>();

  // Step 1: Process markdown-notation shortcodes ({{% ... %}}) BEFORE markdown rendering
  const calls = parseShortcodes(markdown, page.File?.Filename);
  let textAfterMarkdownShortcodes = markdown;

  // Filter markdown-notation shortcodes and process them first
  const mdCalls: ShortcodeCall[] = [];
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i]!;
    if (call.isMarkdown) mdCalls.push(call);
  }

  if (mdCalls.length > 0) {
    textAfterMarkdownShortcodes = processShortcodeCalls(
      markdown,
      mdCalls,
      page,
      site,
      env,
      ordinalTracker,
      undefined,
      recursionGuard,
    );
  }

  const parsedStandardCalls = mdCalls.length === 0
    ? calls
    : parseShortcodes(textAfterMarkdownShortcodes, page.File?.Filename);
  const standardCalls: ShortcodeCall[] = [];
  for (let i = 0; i < parsedStandardCalls.length; i++) {
    const call = parsedStandardCalls[i]!;
    if (!call.isMarkdown) standardCalls.push(call);
  }
  const protectedStandard = protectStandardShortcodes(
    textAfterMarkdownShortcodes,
    standardCalls,
    page,
    site,
    env,
    ordinalTracker,
    recursionGuard,
  );
  const markdownSource = protectedStandard.source;

  const sourcePlan = createMarkdownSourcePlan(markdownSource);
  const fullDocument = createMarkdownDocument(sourcePlan.full_source);
  const toc = sourcePlan.full_source === sourcePlan.toc_source
    ? fullDocument.table_of_contents()
    : createMarkdownDocument(sourcePlan.toc_source).table_of_contents();

  // Step 3: Create render hook context
  const hookCtx = new RenderHookContext(page, site, env);

  const hasHooks = hookCtx.hasAnyHooks();
  let html = hasHooks
    ? renderMarkdownWithHooks(sourcePlan.full_source, hookCtx)
    : fullDocument.render();
  const plainText = fullDocument.plain_text();
  let summaryHtml: string;
  if (sourcePlan.summary_source === "") {
    summaryHtml = "";
  } else if (sourcePlan.summary_source === sourcePlan.full_source) {
    summaryHtml = html.trim();
  } else if (hasHooks) {
    summaryHtml = renderMarkdownWithHooks(sourcePlan.summary_source, hookCtx).trim();
  } else {
    summaryHtml = createMarkdownDocument(sourcePlan.summary_source).render().trim();
  }

  // Step 5: Restore standard-notation shortcode output without Markdown processing.
  html = restoreStandardShortcodes(html, protectedStandard.replacements);
  summaryHtml = restoreStandardShortcodes(summaryHtml, protectedStandard.replacements);

  return new MarkdownResult(html, summaryHtml, plainText, toc);
};
