import type { int32 } from "@tsonic/core/types.js";
import type { TemplateEnvironment } from "../template/environment.js";
import type { TemplateNode } from "../template/nodes.js";
import type { Template } from "../template/template.js";
import {
  LinkHookContext,
  LinkHookValue,
  ImageHookContext,
  ImageHookValue,
  HeadingHookContext,
  HeadingHookValue,
} from "../template/contexts.js";
import { PageContext, SiteContext } from "../models.js";
import { createMarkdownDocument } from "./platform.js";

export class RenderHookContext {
  page: PageContext;
  site: SiteContext;
  env: TemplateEnvironment;
  linkHook: Template | undefined;
  imageHook: Template | undefined;
  headingHook: Template | undefined;

  constructor(page: PageContext, site: SiteContext, env: TemplateEnvironment) {
    this.page = page;
    this.site = site;
    this.env = env;
    this.linkHook = env.getRenderHookTemplate("render-link");
    this.imageHook = env.getRenderHookTemplate("render-image");
    this.headingHook = env.getRenderHookTemplate("render-heading");
  }

  hasAnyHooks(): boolean {
    return this.linkHook !== undefined || this.imageHook !== undefined || this.headingHook !== undefined;
  }
}

const renderHookTemplate = (
  template: Template,
  value: LinkHookValue | ImageHookValue | HeadingHookValue,
  context: RenderHookContext,
): string => {
  const emptyOverrides = new Map<string, TemplateNode[]>();
  return context.env.renderTemplate(template, value, context.site, emptyOverrides);
};

export const renderMarkdownWithHooks = (
  markdown: string,
  context: RenderHookContext,
): string => {
  const document = createMarkdownDocument(markdown);
  if (!context.hasAnyHooks()) return document.render();

  const count: int32 = document.occurrenceCount();
  for (let index: int32 = count - 1; index >= 0; index--) {
    const occurrence = document.occurrence(index);
    if (occurrence.kind === "image") {
      const template = context.imageHook;
      if (template === undefined) continue;
      const value = new ImageHookValue(new ImageHookContext(
        occurrence.destination,
        occurrence.plainText,
        occurrence.title,
        occurrence.plainText,
        context.page,
        context.page,
      ));
      document.replaceHtml(index, renderHookTemplate(template, value, context));
      continue;
    }
    if (occurrence.kind === "link") {
      const template = context.linkHook;
      if (template === undefined) continue;
      const value = new LinkHookValue(new LinkHookContext(
        occurrence.destination,
        document.occurrenceHtml(index),
        occurrence.title,
        occurrence.plainText,
        context.page,
        context.page,
      ));
      document.replaceHtml(index, renderHookTemplate(template, value, context));
      continue;
    }
    if (occurrence.kind === "heading") {
      const template = context.headingHook;
      if (template === undefined) continue;
      const value = new HeadingHookValue(new HeadingHookContext(
        occurrence.level,
        document.occurrenceHtml(index),
        occurrence.plainText,
        occurrence.anchor,
        context.page,
        context.page,
      ));
      document.replaceHtml(index, renderHookTemplate(template, value, context));
    }
  }
  return document.render();
};
