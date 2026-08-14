import { TextBuilder } from "../utils/text-builder.js";
import { PageContext } from "../models.js";
import { PageValue } from "./values.js";
import { RenderScope } from "./scope.js";
import type { TemplateEnvironment } from "./environment.js";
import { TemplateNode } from "./nodes.js";
import { renderTemplateNodes } from "./evaluation/render.js";

export class Template {
  nodes: TemplateNode[];
  defines: Map<string, TemplateNode[]>;

  constructor(nodes: TemplateNode[], defines: Map<string, TemplateNode[]>) {
    this.nodes = nodes;
    this.defines = defines;
  }

  render(root: PageContext, env: TemplateEnvironment, overrides?: Map<string, TemplateNode[]>): string {
    const sb = new TextBuilder();
    const pageValue = new PageValue(root);
    const scope = new RenderScope(pageValue, pageValue, root.site, env, undefined);
    const defs = overrides ?? new Map<string, TemplateNode[]>();
    this.renderInto(sb, scope, env, defs);
    return sb.toString();
  }

  renderInto(sb: TextBuilder, scope: RenderScope, env: TemplateEnvironment, overrides: Map<string, TemplateNode[]>): void {
    renderTemplateNodes(this.nodes, sb, scope, env, overrides, this.defines);
  }
}
