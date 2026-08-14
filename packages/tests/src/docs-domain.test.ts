import { join } from "node:path";

import {
  discoverDocsMountRoutes,
  DocsLinkRewriteContext,
  DocsMountConfig,
  docsOutputPathForPermalink,
  DocsOutputClaims,
  loadDocsConfig,
  loadDocsContent,
  renderDocsMarkdown,
  renderSearchIndexJson,
  resolveDocsOutputPath,
  SearchDocument,
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

const captureDocsDiagnostic = (operation: () => void): string => {
  try {
    operation();
  } catch (error) {
    if (error instanceof TsumoError) return error.diagnostic.code;
    throw error;
  }
  throw new Error("Expected a docs diagnostic");
};

const createMount = (sourceDir: string, prefix: string): DocsMountConfig =>
  new DocsMountConfig("Docs", sourceDir, prefix, undefined, "main", undefined, undefined);

export class DocsDomainTests {
  route_discovery_is_sorted_and_rejects_output_collisions(): void {
    const root = createTestDirectory("docs-routes");
    try {
      const source = join(root, "source");
      createDirectory(join(source, "nested"));
      writeTextFile(join(source, "z.md"), "# Z");
      writeTextFile(join(source, "a.md"), "# A");
      writeTextFile(join(source, "nested", "asset.txt"), "asset");

      const routes = discoverDocsMountRoutes(createMount(source, "/docs/"));
      Assert.NumberEqual(2, routes.markdown.length);
      Assert.True(routes.markdown[0]!.relPath === "a.md");
      Assert.True(routes.markdown[1]!.relPath === "z.md");
      Assert.NumberEqual(1, routes.assets.length);
      Assert.True(routes.assets[0]!.outputRelPath === "docs/nested/asset.txt");

      const conflicting = join(root, "conflicting");
      createDirectory(join(conflicting, "guide"));
      writeTextFile(join(conflicting, "guide.md"), "# Guide");
      writeTextFile(join(conflicting, "guide", "index.md"), "# Other guide");
      Assert.StringEqual(
        "TSUMO_DOCS_ROUTE_CONFLICT",
        captureDocsDiagnostic(() => {
          discoverDocsMountRoutes(createMount(conflicting, "/docs/"));
        }),
      );
    } finally {
      deleteTestDirectory(root);
    }
  }

  content_inventory_excludes_draft_leaf_routes(): void {
    const root = createTestDirectory("docs-content");
    try {
      writeTextFile(join(root, "published.md"), "---\ntitle: Published\n---\nBody");
      writeTextFile(join(root, "draft.md"), "---\ntitle: Draft\ndraft: true\n---\nHidden");
      const routes = discoverDocsMountRoutes(createMount(root, "/docs/")).markdown;

      const production = loadDocsContent(routes, false);
      Assert.NumberEqual(1, production.leaves.length);
      Assert.True(production.permalinkByRelativePath.has("published.md"));
      Assert.True(!production.permalinkByRelativePath.has("draft.md"));

      const withDrafts = loadDocsContent(routes, true);
      Assert.NumberEqual(2, withDrafts.leaves.length);
      Assert.True(withDrafts.permalinkByRelativePath.has("draft.md"));
    } finally {
      deleteTestDirectory(root);
    }
  }

  docs_config_has_one_closed_schema(): void {
    const root = createTestDirectory("docs-config");
    try {
      createDirectory(join(root, "content"));
      const configPath = join(root, "tsumo.docs.json");
      writeTextFile(
        configPath,
        "{\"siteName\":\"Contract\",\"mounts\":[{\"name\":\"Main\",\"source\":\"./content\",\"prefix\":\"/docs/\"}]}",
      );
      const loaded = loadDocsConfig(root);
      Assert.True(loaded !== undefined && loaded.config.mounts.length === 1);
      Assert.True(loaded !== undefined && loaded.config.mounts[0]!.urlPrefix === "/docs/");

      writeTextFile(
        configPath,
        "{\"mounts\":[{\"source\":\"./content\",\"prefix\":\"/docs/\",\"repo\":\"https://example.invalid\"}]}",
      );
      Assert.StringEqual(
        "TSUMO_DOCS_CONFIG_UNKNOWN_PROPERTY",
        captureDocsDiagnostic(() => {
          loadDocsConfig(root);
        }),
      );

      writeTextFile(
        configPath,
        "{\"search\":\"yes\",\"mounts\":[{\"source\":\"./content\",\"prefix\":\"/docs/\"}]}",
      );
      Assert.StringEqual(
        "TSUMO_DOCS_CONFIG_TYPE",
        captureDocsDiagnostic(() => {
          loadDocsConfig(root);
        }),
      );
    } finally {
      deleteTestDirectory(root);
    }
  }

  output_and_search_plans_are_exact_and_deterministic(): void {
    const root = createTestDirectory("docs-output");
    try {
      Assert.StringEqual("guide/index.html", docsOutputPathForPermalink("/guide/"));
      Assert.StringEqual(
        "TSUMO_DOCS_OUTPUT_PATH_ESCAPES_ROOT",
        captureDocsDiagnostic(() => {
          resolveDocsOutputPath(root, "../outside.html");
        }),
      );
      Assert.StringEqual(
        "TSUMO_DOCS_OUTPUT_PATH_ABSOLUTE",
        captureDocsDiagnostic(() => {
          resolveDocsOutputPath(root, "/outside.html");
        }),
      );

      const claims = new DocsOutputClaims();
      claims.add("docs/index.html", "first.md");
      Assert.StringEqual(
        "TSUMO_DOCS_ROUTE_CONFLICT",
        captureDocsDiagnostic(() => {
          claims.add("DOCS/index.html", "second.md");
        }),
      );

      const documents = [
        new SearchDocument("Zulu", "/z/", "Docs", "last"),
        new SearchDocument("Alpha", "/a/", "Docs", "quoted \"value\""),
      ];
      const expected = "[{\"title\":\"Alpha\",\"url\":\"/a/\",\"mount\":\"Docs\",\"text\":\"quoted \\\"value\\\"\"},{\"title\":\"Zulu\",\"url\":\"/z/\",\"mount\":\"Docs\",\"text\":\"last\"}]";
      Assert.StringEqual(expected, renderSearchIndexJson(documents));
      Assert.StringEqual(expected, renderSearchIndexJson(documents));
    } finally {
      deleteTestDirectory(root);
    }
  }

  strict_markdown_links_fail_closed(): void {
    const mount = createMount("/docs", "/docs/");
    const routes = new Map<string, string>();
    routes.set("known.md", "/docs/known/");
    const context = new DocsLinkRewriteContext(mount, "/docs/current.md", "", routes, true);
    const rendered = renderDocsMarkdown("[Known](known.md)", context);
    Assert.True(rendered.html.includes("/docs/known/"));
    Assert.StringEqual(
      "TSUMO_DOCS_LINK_UNRESOLVED",
      captureDocsDiagnostic(() => {
        renderDocsMarkdown("[Missing](missing.md)", context);
      }),
    );
    Assert.StringEqual(
      "TSUMO_DOCS_LINK_UNSAFE",
      captureDocsDiagnostic(() => {
        renderDocsMarkdown("[Unsafe](javascript:alert(1))", context);
      }),
    );
  }
}

export const runDocsDomainTests = (): void => {
  const tests = new DocsDomainTests();
  runTest("docs route discovery is sorted and rejects output collisions", () => {
    tests.route_discovery_is_sorted_and_rejects_output_collisions();
  });
  runTest("docs content inventory excludes draft leaf routes", () => {
    tests.content_inventory_excludes_draft_leaf_routes();
  });
  runTest("docs config has one closed schema", () => {
    tests.docs_config_has_one_closed_schema();
  });
  runTest("docs output and search plans are exact and deterministic", () => {
    tests.output_and_search_plans_are_exact_and_deterministic();
  });
  runTest("strict markdown links fail closed", () => {
    tests.strict_markdown_links_fail_closed();
  });
};
