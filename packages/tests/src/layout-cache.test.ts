import { join } from "node:path";

import { LayoutEnvironment, PageValue, Template, TemplateNode } from "@tsumo/engine/testing.js";
import {
  Assert,
  createDirectory,
  createTestDirectory,
  deleteTestDirectory,
  runTest,
  writeTextFile,
} from "./test-root.js";
import { createPage, createSite } from "./template-test-harness.js";

const requireTemplate = (template: Template | undefined): Template => {
  if (template === undefined) throw new Error("Expected template to exist");
  return template;
};

const render = (environment: LayoutEnvironment, template: Template): string => {
  const site = createSite();
  const page = createPage(site, "Cache", "", "page");
  return environment.renderTemplate(
    template,
    new PageValue(page),
    site,
    new Map<string, TemplateNode[]>(),
  );
};

export class LayoutCacheTests {
  logical_results_are_stable_within_one_build_and_refreshed_between_builds(): void {
    const root = createTestDirectory("layout-cache");
    const site = join(root, "site");
    const layouts = join(site, "layouts");
    try {
      createDirectory(layouts);
      writeTextFile(join(layouts, "single.html"), "first");

      const firstBuild = new LayoutEnvironment(site, undefined);
      const firstTemplate = requireTemplate(firstBuild.getTemplate("single.html"));
      Assert.StringEqual("first", render(firstBuild, firstTemplate));
      Assert.True(firstBuild.getTemplate("single.html") === firstTemplate);

      Assert.True(firstBuild.getTemplate("late.html") === undefined);
      writeTextFile(join(layouts, "single.html"), "second");
      writeTextFile(join(layouts, "late.html"), "late");
      Assert.StringEqual("first", render(firstBuild, requireTemplate(firstBuild.getTemplate("single.html"))));
      Assert.True(firstBuild.getTemplate("late.html") === undefined);

      const secondBuild = new LayoutEnvironment(site, undefined);
      Assert.StringEqual("second", render(secondBuild, requireTemplate(secondBuild.getTemplate("single.html"))));
      Assert.StringEqual("late", render(secondBuild, requireTemplate(secondBuild.getTemplate("late.html"))));
    } finally {
      deleteTestDirectory(root);
    }
  }
}

export const runLayoutCacheTests = (): void => {
  const tests = new LayoutCacheTests();
  runTest("logical template results are stable per build and refreshed between builds", () => {
    tests.logical_results_are_stable_within_one_build_and_refreshed_between_builds();
  });
};
