import { join } from "node:path";

import { BuildRequest, TsumoError, buildSite, initSite, newContent } from "@tsumo/engine/index.js";
import { listFilesRecursive } from "@tsumo/engine/testing.js";
import {
  Assert,
  createDirectory,
  createTestDirectory,
  deleteTestDirectory,
  directoryExists,
  fileExists,
  runTest,
  writeTextFile,
} from "./test-root.js";

const captureScaffoldDiagnostic = (operation: () => void): string => {
  try {
    operation();
  } catch (error) {
    if (error instanceof TsumoError) return error.diagnostic.code;
    throw error;
  }
  throw new Error("Expected a scaffold diagnostic");
};

export class ScaffoldAndBuildTests {
  scaffold_then_build(): void {
    const siteDir = createTestDirectory("site");
    const outDir = createTestDirectory("out");

    try {
      initSite(siteDir);

      const req = new BuildRequest(siteDir);
      req.destinationDir = outDir;
      req.cleanDestinationDir = true;

      const result = buildSite(req);

      Assert.True(directoryExists(outDir));
      Assert.True(fileExists(join(outDir, "index.html")));
      Assert.True(fileExists(join(outDir, "posts", "hello-world", "index.html")));
      Assert.NumberEqual(12, result.pagesBuilt);
      Assert.NumberEqual(13, listFilesRecursive(outDir, "*").length);
    } finally {
      deleteTestDirectory(outDir);
      deleteTestDirectory(siteDir);
    }
  }

  drafts_skipped_by_default(): void {
    const siteDir = createTestDirectory("site");
    const outDir = createTestDirectory("out");

    try {
      initSite(siteDir);
      newContent(siteDir, "posts/my-draft.md");

      const req = new BuildRequest(siteDir);
      req.destinationDir = outDir;
      req.cleanDestinationDir = true;
      req.buildDrafts = false;

      buildSite(req);

      Assert.True(!fileExists(join(outDir, "posts", "my-draft", "index.html")));
    } finally {
      deleteTestDirectory(outDir);
      deleteTestDirectory(siteDir);
    }
  }

  new_content_then_build(): void {
    const siteDir = createTestDirectory("site");
    const outDir = createTestDirectory("out");

    try {
      initSite(siteDir);
      newContent(siteDir, "posts/my-post.md");

      const req = new BuildRequest(siteDir);
      req.destinationDir = outDir;
      req.cleanDestinationDir = true;
      req.buildDrafts = true;

      buildSite(req);

      Assert.True(fileExists(join(outDir, "posts", "my-post", "index.html")));
    } finally {
      deleteTestDirectory(outDir);
      deleteTestDirectory(siteDir);
    }
  }

  scaffold_boundaries_fail_closed_with_exact_diagnostics(): void {
    const root = createTestDirectory("scaffold-boundaries");
    try {
      const occupied = join(root, "occupied");
      createDirectory(occupied);
      writeTextFile(join(occupied, "keep.txt"), "keep");
      Assert.StringEqual(
        "TSUMO_SCAFFOLD_DESTINATION_NOT_EMPTY",
        captureScaffoldDiagnostic(() => {
          initSite(occupied);
        }),
      );

      const site = join(root, "site");
      initSite(site);
      Assert.StringEqual(
        "TSUMO_SCAFFOLD_CONTENT_PATH_ESCAPES_ROOT",
        captureScaffoldDiagnostic(() => {
          newContent(site, "../outside.md");
        }),
      );
      newContent(site, "posts/exact.md");
      Assert.StringEqual(
        "TSUMO_SCAFFOLD_CONTENT_EXISTS",
        captureScaffoldDiagnostic(() => {
          newContent(site, "posts/exact.md");
        }),
      );
    } finally {
      deleteTestDirectory(root);
    }
  }
}

export const runScaffoldAndBuildTests = (): void => {
  const tests = new ScaffoldAndBuildTests();
  runTest("scaffold then build", () => {
    tests.scaffold_then_build();
  });
  runTest("drafts are skipped by default", () => {
    tests.drafts_skipped_by_default();
  });
  runTest("new content then build", () => {
    tests.new_content_then_build();
  });
  runTest("scaffold boundaries fail closed with exact diagnostics", () => {
    tests.scaffold_boundaries_fail_closed_with_exact_diagnostics();
  });
};
