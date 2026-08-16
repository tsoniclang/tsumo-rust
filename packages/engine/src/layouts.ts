import type { char, int32 } from "@tsonic/core/types.js";
import { TextBuilder } from "./utils/text-builder.js";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { dirExists, fileExists, readTextFile } from "./fs.js";
import { PageValue, parseTemplate, Template, TemplateEnvironment, TemplateNode } from "./template/index.js";
import type { ResourceManager } from "./resources.js";
import { I18nStore } from "./i18n.js";
import { ModuleMount, PageContext } from "./models.js";
import type { SiteContext } from "./models.js";
import { replaceText, trimStartChar } from "./utils/strings.js";
import { RenderScope, RenderState } from "./template/scope.js";
import type { DictValue, TemplateValue } from "./template/values.js";
import { getEmbeddedTemplateSource } from "./template/embedded-templates.js";
import { normalizeTemplateRelativePath } from "./template/paths.js";
import { pathContainsOrEquals } from "./utils/paths.js";

export class LayoutEnvironment extends TemplateEnvironment {
  siteLayoutsDir: string;
  themeLayoutsDir: string | undefined;
  mountedLayoutDirs: string[];
  parsedTemplateBySource: Map<string, Template>;
  templateByLogicalPath: Map<string, Template>;
  missingLogicalTemplatePaths: Set<string>;
  shortcodeTemplateByName: Map<string, Template>;
  missingShortcodeNames: Set<string>;
  renderHookTemplateByName: Map<string, Template>;
  missingRenderHookNames: Set<string>;
  i18nStore: I18nStore;

  constructor(siteDir: string, themeDirRaw: string | undefined, mountsRaw?: ModuleMount[], buildTime?: Date, siteData?: DictValue) {
    super(buildTime, siteData);
    const themeDir = themeDirRaw;
    const mounts = mountsRaw;
    this.siteLayoutsDir = join(siteDir, "layouts");
    this.themeLayoutsDir = themeDir !== undefined ? join(themeDir, "layouts") : undefined;
    this.mountedLayoutDirs = [];
    this.parsedTemplateBySource = new Map<string, Template>();
    this.templateByLogicalPath = new Map<string, Template>();
    this.missingLogicalTemplatePaths = new Set<string>();
    this.shortcodeTemplateByName = new Map<string, Template>();
    this.missingShortcodeNames = new Set<string>();
    this.renderHookTemplateByName = new Map<string, Template>();
    this.missingRenderHookNames = new Set<string>();
    this.i18nStore = new I18nStore();
    if (themeDir !== undefined) {
      this.i18nStore.loadFromDir(join(themeDir, "i18n"));
    }

    if (mounts !== undefined) {
      for (let i = mounts.length - 1; i >= 0; i--) {
        const mount = mounts[i]!;
        if (mount.target !== "i18n") continue;
        const mountPath = isAbsolute(mount.source) ? mount.source : join(siteDir, mount.source);
        if (dirExists(mountPath)) this.i18nStore.loadFromDir(mountPath);
      }
    }
    this.i18nStore.loadFromDir(join(siteDir, "i18n"));

    if (mounts !== undefined) {
      for (let i = 0; i < mounts.length; i++) {
        const mount = mounts[i]!;
        if (mount.target === "layouts") {
          const mountPath = isAbsolute(mount.source) ? mount.source : join(siteDir, mount.source);
          if (dirExists(mountPath)) {
            this.mountedLayoutDirs.push(mountPath);
          }
        }
      }
    }
  }

  getResourceManager(): ResourceManager | undefined {
    return undefined;
  }

  renderTextTemplateSource(
    source: string,
    context: TemplateValue,
    site: SiteContext,
    overrides: Map<string, TemplateNode[]>,
    state?: RenderState,
  ): string {
    return this.renderTextTemplate(parseTemplate(source), context, site, overrides, state);
  }

  renderTemplate(
    template: Template,
    context: TemplateValue,
    site: SiteContext,
    overrides: Map<string, TemplateNode[]>,
    state?: RenderState,
  ): string {
    const output = new TextBuilder();
    const scope = new RenderScope(context, context, site, this, undefined, state, template.sourcePath);
    template.renderInto(output, scope, this, overrides);
    return output.toString();
  }

  renderTextTemplate(
    template: Template,
    context: TemplateValue,
    site: SiteContext,
    overrides: Map<string, TemplateNode[]>,
    state?: RenderState,
  ): string {
    const output = new TextBuilder();
    const scope = new RenderScope(context, context, site, this, undefined, state, template.sourcePath);
    template.renderTextInto(output, scope, this, overrides);
    return output.toString();
  }

  renderTemplateDefinition(
    nodes: TemplateNode[],
    definitions: Map<string, TemplateNode[]>,
    sourcePath: string | undefined,
    context: TemplateValue,
    site: SiteContext,
    overrides: Map<string, TemplateNode[]>,
    state?: RenderState,
  ): string {
    return this.renderTemplate(new Template(nodes, definitions, sourcePath), context, site, overrides, state);
  }

  getTemplate(relPathRaw: string): Template | undefined {
    const slash = "/";
    const relPath = normalizeTemplateRelativePath(trimStartChar(relPathRaw, slash).trim());
    const logicalCached = this.templateByLogicalPath.get(relPath);
    if (logicalCached !== undefined) return logicalCached;
    if (this.missingLogicalTemplatePaths.has(relPath)) return undefined;
    const relativePaths: string[] = [];
    if (extname(relPath) !== "") relativePaths.push(relPath);
    else {
      relativePaths.push(relPath + ".html");
      relativePaths.push(relPath + ".htm");
    }

    const candidates: string[] = [];
    for (let i = 0; i < relativePaths.length; i++) {
      candidates.push(join(this.siteLayoutsDir, replaceText(relativePaths[i]!, slash, `${sep}`)));
    }
    const themeLayoutsDir = this.themeLayoutsDir;
    if (themeLayoutsDir !== undefined) {
      for (let i = 0; i < relativePaths.length; i++) {
        candidates.push(join(themeLayoutsDir, replaceText(relativePaths[i]!, slash, `${sep}`)));
      }
    }
    for (let i = 0; i < this.mountedLayoutDirs.length; i++) {
      for (let pathIndex = 0; pathIndex < relativePaths.length; pathIndex++) {
        candidates.push(join(this.mountedLayoutDirs[i]!, replaceText(relativePaths[pathIndex]!, slash, `${sep}`)));
      }
    }

    let resolved: string | undefined = undefined;
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i]!;
      if (fileExists(candidate)) {
        resolved = candidate;
        break;
      }
    }
    if (resolved === undefined) {
      let embeddedPath: string | undefined = undefined;
      let embeddedSource: string | undefined = undefined;
      for (let i = 0; i < relativePaths.length; i++) {
        const candidateSource = getEmbeddedTemplateSource(relativePaths[i]!);
        if (candidateSource === undefined) continue;
        embeddedPath = relativePaths[i]!;
        embeddedSource = candidateSource;
        break;
      }
      if (embeddedSource === undefined || embeddedPath === undefined) {
        this.missingLogicalTemplatePaths.add(relPath);
        return undefined;
      }
      const embeddedKey = `embedded:${embeddedPath.toLowerCase()}`;
      const embeddedCached = this.parsedTemplateBySource.get(embeddedKey);
      if (embeddedCached !== undefined) {
        this.templateByLogicalPath.set(relPath, embeddedCached);
        return embeddedCached;
      }
      const embedded = parseTemplate(embeddedSource, embeddedKey);
      this.parsedTemplateBySource.set(embeddedKey, embedded);
      this.templateByLogicalPath.set(relPath, embedded);
      return embedded;
    }

    const cached = this.parsedTemplateBySource.get(resolved);
    if (cached !== undefined) {
      this.templateByLogicalPath.set(relPath, cached);
      return cached;
    }

    const text = readTextFile(resolved);
    const tpl = parseTemplate(text, resolved);
    this.parsedTemplateBySource.set(resolved, tpl);
    this.templateByLogicalPath.set(relPath, tpl);
    return tpl;
  }

  getTemplateSourceRelativePath(sourcePath: string): string | undefined {
    const source = resolve(sourcePath);
    const roots: string[] = [this.siteLayoutsDir];
    const themeLayoutsDir = this.themeLayoutsDir;
    if (themeLayoutsDir !== undefined) roots.push(themeLayoutsDir);
    for (let index = 0; index < this.mountedLayoutDirs.length; index++) {
      roots.push(this.mountedLayoutDirs[index]!);
    }

    for (let index = 0; index < roots.length; index++) {
      const root = resolve(roots[index]!);
      if (!pathContainsOrEquals(root, source)) continue;
      return normalizeTemplateRelativePath(replaceText(relative(root, source), "\\", "/"));
    }
    return undefined;
  }

  renderPageView(page: PageContext, viewRaw: string, state: RenderState | undefined): string | undefined {
    const view = normalizeTemplateRelativePath(viewRaw);
    if (view === "") return undefined;
    const candidates: string[] = [];
    if (page.type.trim() !== "") candidates.push(`${page.type}/${view}`);
    if (page.section.trim() !== "" && page.section !== page.type) candidates.push(`${page.section}/${view}`);
    candidates.push(`_default/${view}`);
    candidates.push(view);
    const templatePath = selectTemplatePath(this, candidates);
    if (templatePath === undefined) return undefined;
    const template = this.getTemplate(templatePath);
    if (template === undefined) return undefined;
    const context = new PageValue(page);
    return this.renderTemplate(template, context, page.site, new Map<string, TemplateNode[]>(), state);
  }

  getShortcodeTemplate(name: string): Template | undefined {
    const cached = this.shortcodeTemplateByName.get(name);
    if (cached !== undefined) return cached;
    if (this.missingShortcodeNames.has(name)) return undefined;

    const candidates: string[] = [
      join(this.siteLayoutsDir, "shortcodes", name + ".html"),
      join(this.siteLayoutsDir, "_shortcodes", name + ".html"),
    ];
    const themeLayoutsDir = this.themeLayoutsDir;
    if (themeLayoutsDir !== undefined) {
      candidates.push(join(themeLayoutsDir, "shortcodes", name + ".html"));
      candidates.push(join(themeLayoutsDir, "_shortcodes", name + ".html"));
    }
    for (let i = 0; i < this.mountedLayoutDirs.length; i++) {
      const dir = this.mountedLayoutDirs[i]!;
      candidates.push(join(dir, "shortcodes", name + ".html"));
      candidates.push(join(dir, "_shortcodes", name + ".html"));
    }

    let resolved: string | undefined = undefined;
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i]!;
      if (fileExists(candidate)) {
        resolved = candidate;
        break;
      }
    }
    if (resolved === undefined) {
      this.missingShortcodeNames.add(name);
      return undefined;
    }

    const tpl = parseTemplate(readTextFile(resolved), resolved);
    this.shortcodeTemplateByName.set(name, tpl);
    return tpl;
  }

  getRenderHookTemplate(hookName: string): Template | undefined {
    const cached = this.renderHookTemplateByName.get(hookName);
    if (cached !== undefined) return cached;
    if (this.missingRenderHookNames.has(hookName)) return undefined;

    const candidates: string[] = [
      join(this.siteLayoutsDir, "_markup", hookName + ".html"),
      join(this.siteLayoutsDir, "_default", "_markup", hookName + ".html"),
    ];
    const themeLayoutsDir = this.themeLayoutsDir;
    if (themeLayoutsDir !== undefined) {
      candidates.push(join(themeLayoutsDir, "_markup", hookName + ".html"));
      candidates.push(join(themeLayoutsDir, "_default", "_markup", hookName + ".html"));
    }
    for (let i = 0; i < this.mountedLayoutDirs.length; i++) {
      const dir = this.mountedLayoutDirs[i]!;
      candidates.push(join(dir, "_markup", hookName + ".html"));
      candidates.push(join(dir, "_default", "_markup", hookName + ".html"));
    }

    let resolved: string | undefined = undefined;
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i]!;
      if (fileExists(candidate)) {
        resolved = candidate;
        break;
      }
    }
    if (resolved === undefined) {
      this.missingRenderHookNames.add(hookName);
      return undefined;
    }

    const tpl = parseTemplate(readTextFile(resolved), resolved);
    this.renderHookTemplateByName.set(hookName, tpl);
    return tpl;
  }

  getI18n(lang: string, key: string, count?: int32): string {
    return this.i18nStore.translate(lang, key, count);
  }
}

const selectTemplatePath = (environment: LayoutEnvironment, candidates: string[]): string | undefined => {
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]!;
    if (environment.getTemplate(candidate) !== undefined) return candidate;
  }
  return undefined;
};
