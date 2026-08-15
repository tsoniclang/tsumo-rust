import { join } from "node:path";

import { SiteOutputPlan, TsumoError } from "@tsumo/engine/testing.js";
import {
  Assert,
  createDirectory,
  createTestDirectory,
  deleteTestDirectory,
  readTextFile,
  runTest,
  writeTextFile,
} from "./test-root.js";

const captureOutputDiagnostic = (operation: () => void): string => {
  try {
    operation();
  } catch (error) {
    if (error instanceof TsumoError) return error.diagnostic.code;
    throw error;
  }
  throw new Error("Expected an output-plan diagnostic");
};

export class OutputPlanTests {
  paths_and_collisions_fail_before_rendering(): void {
    const plan = new SiteOutputPlan();
    Assert.StringEqual(
      "TSUMO_OUTPUT_PATH_ESCAPES_ROOT",
      captureOutputDiagnostic(() => {
        plan.addText("../outside.html", "outside", "escape");
      }),
    );
    plan.addText("pages/index.html", "first", "first page");
    Assert.StringEqual(
      "TSUMO_OUTPUT_PATH_CONFLICT",
      captureOutputDiagnostic(() => {
        plan.addText("PAGES/index.html", "second", "second page");
      }),
    );
  }

  static_layers_have_one_explicit_precedence_policy(): void {
    const root = createTestDirectory("output-plan-static");
    const theme = join(root, "theme");
    const site = join(root, "site");
    const output = join(root, "output");
    try {
      createDirectory(theme);
      createDirectory(site);
      writeTextFile(join(theme, "style.css"), "theme");
      writeTextFile(join(theme, "robots.txt"), "theme robots");
      writeTextFile(join(site, "style.css"), "site");
      writeTextFile(join(site, "robots.txt"), "site robots");

      const plan = new SiteOutputPlan();
      plan.addDirectory(theme, "", "theme static", "theme-static");
      plan.addDirectory(site, "", "site static", "site-static");
      plan.addDefaultText("robots.txt", "generated robots", "generated robots");
      plan.addText("index.html", "home", "home");
      Assert.NumberEqual(1, plan.generatedOutputCount());
      plan.render(output);

      Assert.StringEqual("site", readTextFile(join(output, "style.css")));
      Assert.StringEqual("site robots", readTextFile(join(output, "robots.txt")));
      Assert.StringEqual("home", readTextFile(join(output, "index.html")));
    } finally {
      deleteTestDirectory(root);
    }
  }

  bundle_assets_cannot_overwrite_generated_routes(): void {
    const root = createTestDirectory("output-plan-bundle");
    try {
      const asset = join(root, "index.html");
      writeTextFile(asset, "asset");
      const plan = new SiteOutputPlan();
      plan.addText("index.html", "generated", "home");
      Assert.StringEqual(
        "TSUMO_OUTPUT_PATH_CONFLICT",
        captureOutputDiagnostic(() => {
          plan.addAsset("index.html", asset, "bundle", "bundle");
        }),
      );
    } finally {
      deleteTestDirectory(root);
    }
  }

  deferred_replacements_snapshot_outputs_before_mutation(): void {
    const root = createTestDirectory("output-plan-deferred");
    const output = join(root, "output");
    try {
      const plan = new SiteOutputPlan();
      plan.addText("first.html", "before:<deferred-token>:after", "first page");
      plan.addText("second.html", "unchanged", "second page");
      const results = new Map<string, string>();
      results.set("<deferred-token>", "ready");

      plan.applyDeferredTemplateResults(results);
      plan.render(output);

      Assert.StringEqual("before:ready:after", readTextFile(join(output, "first.html")));
      Assert.StringEqual("unchanged", readTextFile(join(output, "second.html")));
    } finally {
      deleteTestDirectory(root);
    }
  }
}

export const runOutputPlanTests = (): void => {
  const tests = new OutputPlanTests();
  runTest("paths and collisions fail before rendering", () => {
    tests.paths_and_collisions_fail_before_rendering();
  });
  runTest("static layers have one explicit precedence policy", () => {
    tests.static_layers_have_one_explicit_precedence_policy();
  });
  runTest("bundle assets cannot overwrite generated routes", () => {
    tests.bundle_assets_cannot_overwrite_generated_routes();
  });
  runTest("deferred replacements snapshot outputs before mutation", () => {
    tests.deferred_replacements_snapshot_outputs_before_mutation();
  });
};
