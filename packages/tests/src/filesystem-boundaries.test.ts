import { join } from "node:path";

import {
  TsumoDiagnostic,
  TsumoError,
  createWatchSnapshot,
  listDirectoriesTopDirectory,
  listFilesRecursive,
  listFilesTopDirectory,
  watchSnapshotsEqual,
} from "@tsumo/engine/testing.js";
import {
  Assert,
  createDirectory,
  createSymbolicLink,
  createTestDirectory,
  deleteTestDirectory,
  runTest,
  writeTextFile,
} from "./test-root.js";

const captureTsumoDiagnostic = (operation: () => void): TsumoDiagnostic => {
  try {
    operation();
  } catch (error) {
    if (error instanceof TsumoError) return error.diagnostic;
    throw error;
  }
  throw new Error("Expected a Tsumo error");
};

export class FilesystemBoundaryTests {
  recursive_discovery_is_sorted_and_rejects_links(): void {
    const root = createTestDirectory("filesystem-discovery");
    try {
      const source = join(root, "source");
      const nested = join(source, "a");
      const outside = join(root, "outside");
      createDirectory(nested);
      createDirectory(outside);
      writeTextFile(join(source, "z.txt"), "z");
      writeTextFile(join(nested, "b.txt"), "b");
      writeTextFile(join(nested, "a.txt"), "a");
      writeTextFile(join(outside, "outside.txt"), "outside");

      Assert.StringArrayEqual([
        join(nested, "a.txt"),
        join(nested, "b.txt"),
        join(source, "z.txt"),
      ], listFilesRecursive(source, "*.txt"));
      Assert.StringArrayEqual([join(source, "z.txt")], listFilesTopDirectory(source, "*.txt"));
      Assert.StringArrayEqual([nested], listDirectoriesTopDirectory(source));

      const link = join(source, "linked-directory");
      createSymbolicLink(outside, link);
      const diagnostic = captureTsumoDiagnostic(() => {
        listFilesRecursive(source, "*");
      });
      Assert.StringEqual("TSUMO_FILESYSTEM_LINK_UNSUPPORTED", diagnostic.code);
      Assert.StringEqual(link, diagnostic.file);
    } finally {
      deleteTestDirectory(root);
    }
  }

  watch_snapshots_detect_file_changes_and_use_link_policy(): void {
    const root = createTestDirectory("watch-snapshot");
    try {
      const watched = join(root, "watched");
      createDirectory(watched);
      const file = join(watched, "page.md");
      writeTextFile(file, "before");

      const initial = createWatchSnapshot([watched]);
      Assert.True(watchSnapshotsEqual(initial, createWatchSnapshot([watched])));
      writeTextFile(file, "after with a different size");
      Assert.False(watchSnapshotsEqual(initial, createWatchSnapshot([watched])));

      const link = join(watched, "linked-file.md");
      createSymbolicLink(file, link);
      Assert.StringEqual(
        "TSUMO_FILESYSTEM_LINK_UNSUPPORTED",
        captureTsumoDiagnostic(() => {
          createWatchSnapshot([watched]);
        }).code,
      );
    } finally {
      deleteTestDirectory(root);
    }
  }
}

export const runFilesystemBoundaryTests = (): void => {
  const tests = new FilesystemBoundaryTests();
  runTest("recursive discovery is sorted and rejects links", () => {
    tests.recursive_discovery_is_sorted_and_rejects_links();
  });
  runTest("watch snapshots detect file changes and use link policy", () => {
    tests.watch_snapshots_detect_file_changes_and_use_link_policy();
  });
};
