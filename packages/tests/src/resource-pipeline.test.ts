import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { join } from "node:path";

import {
  createStringResource,
  fingerprintResource,
  normalizeResourceRelativePath,
  parseImageDimensions,
  Resource,
  ResourceData,
  resourceGlobMatches,
  ResourceManager,
  TsumoError,
} from "@tsumo/engine/testing.js";
import {
  Assert,
  createDirectory,
  createTestDirectory,
  deleteTestDirectory,
  runTest,
  writeTextFile,
} from "./test-root.js";

const captureResourceDiagnostic = (operation: () => void): string => {
  try {
    operation();
  } catch (error) {
    if (error instanceof TsumoError) return error.diagnostic.code;
    throw error;
  }
  throw new Error("Expected a resource diagnostic");
};

export class ResourcePipelineTests {
  relative_path_policy_rejects_every_escape_form(): void {
    Assert.StringEqual(
      "TSUMO_RESOURCE_PATH_ESCAPES_ROOT",
      captureResourceDiagnostic(() => {
        normalizeResourceRelativePath("../secret.txt");
      }),
    );
    Assert.StringEqual(
      "TSUMO_RESOURCE_PATH_ESCAPES_ROOT",
      captureResourceDiagnostic(() => {
        normalizeResourceRelativePath("assets/../../secret.txt");
      }),
    );
    Assert.StringEqual(
      "TSUMO_RESOURCE_PATH_ABSOLUTE",
      captureResourceDiagnostic(() => {
        normalizeResourceRelativePath("C:\\secret.txt");
      }),
    );
    Assert.StringEqual("images/logo.png", normalizeResourceRelativePath("/images/./logo.png"));
  }

  glob_matching_is_segment_exact(): void {
    Assert.True(resourceGlobMatches("images/**/*.png", "images/icons/logo.png"));
    Assert.True(resourceGlobMatches("*.css", "site.css"));
    Assert.True(resourceGlobMatches("{*cover*,*thumbnail*}", "article-cover.png"));
    Assert.True(resourceGlobMatches("{*cover*,*thumbnail*}", "article-thumbnail.png"));
    Assert.True(!resourceGlobMatches("{*cover*,*thumbnail*}", "article-logo.png"));
    Assert.True(!resourceGlobMatches("*.css", "nested/site.css"));
    Assert.True(!resourceGlobMatches("images/*.png", "images/icons/logo.png"));
  }

  image_dimensions_are_read_from_exact_file_signatures(): void {
    const png = Buffer.from([
      137, 80, 78, 71, 13, 10, 26, 10,
      0, 0, 0, 13, 73, 72, 68, 82,
      0, 0, 0, 2, 0, 0, 0, 3,
    ]);
    const dimensions = parseImageDimensions(png);
    Assert.True(dimensions !== undefined && dimensions.width === 2 && dimensions.height === 3);
    Assert.True(parseImageDimensions(Buffer.from([1, 2, 3])) === undefined);
  }

  transform_identity_and_metadata_are_content_exact(): void {
    const first = createStringResource("style.css", "a {}");
    const second = createStringResource("style.css", "b {}");
    Assert.True(first.id !== second.id);
    Assert.True(first.publishable);
    Assert.StringEqual("style.css", first.outputRelPath);
    Assert.StringEqual("text/css", first.mediaType);

    const source = new Resource(
      "source",
      undefined,
      true,
      "css/site.css",
      Buffer.from("body {}", "utf8"),
      "body {}",
      new ResourceData(""),
      "text/css",
      10,
      20,
    );
    const fingerprinted = fingerprintResource(source);
    Assert.StringEqual("text/css", fingerprinted.mediaType);
    Assert.NumberEqual(10, fingerprinted.width);
    Assert.NumberEqual(20, fingerprinted.height);
    const expectedHash = createHash("sha256").update(source.bytes).digest("hex").slice(0, 16);
    Assert.True(fingerprinted.outputRelPath === `css/site.${expectedHash}.css`);
    Assert.True(fingerprinted.Data.Integrity.startsWith("sha256-"));
  }

  resource_lookup_is_sorted_and_site_assets_override_theme_assets(): void {
    const root = createTestDirectory("resources");
    const siteDir = join(root, "site");
    const themeDir = join(root, "theme");
    const outputDir = join(root, "output");
    try {
      createDirectory(join(siteDir, "assets"));
      createDirectory(join(themeDir, "assets"));
      writeTextFile(join(siteDir, "assets", "z.txt"), "site-z");
      writeTextFile(join(siteDir, "assets", "a.txt"), "site-a");
      writeTextFile(join(siteDir, "assets", "main.ts"), "export const value = 1;");
      writeTextFile(join(themeDir, "assets", "a.txt"), "theme-a");
      writeTextFile(join(themeDir, "assets", "m.txt"), "theme-m");

      const manager = new ResourceManager(siteDir, themeDir, outputDir);
      const matched = manager.match("*.txt");
      Assert.NumberEqual(3, matched.length);
      Assert.True(matched[0]!.outputRelPath === "a.txt");
      Assert.True(matched[1]!.outputRelPath === "m.txt");
      Assert.True(matched[2]!.outputRelPath === "z.txt");
      Assert.True(matched[0]!.text === "site-a");
      Assert.NumberEqual(4, manager.byType("text").length);
      const typescript = manager.get("main.ts");
      Assert.True(typescript !== undefined && typescript.text === "export const value = 1;");
      Assert.True(typescript !== undefined && typescript.mediaType === "text/typescript");
    } finally {
      deleteTestDirectory(root);
    }
  }
}

export const runResourcePipelineTests = (): void => {
  const tests = new ResourcePipelineTests();
  runTest("relative path policy rejects every escape form", () => {
    tests.relative_path_policy_rejects_every_escape_form();
  });
  runTest("glob matching is segment exact", () => {
    tests.glob_matching_is_segment_exact();
  });
  runTest("image dimensions are read from exact file signatures", () => {
    tests.image_dimensions_are_read_from_exact_file_signatures();
  });
  runTest("transform identity and metadata are content exact", () => {
    tests.transform_identity_and_metadata_are_content_exact();
  });
  runTest("resource lookup is sorted and site assets override theme assets", () => {
    tests.resource_lookup_is_sorted_and_site_assets_override_theme_assets();
  });
};
