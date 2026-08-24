import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { repoRoot } from "./helpers.mjs";

const repositoryFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: repoRoot, encoding: "utf8" },
).split("\0").filter((path) => path !== "" && existsSync(join(repoRoot, path)));

const sourceFiles = repositoryFiles.filter((path) =>
  /^packages\/(?:cli|engine|tests)\/src\/.*\.ts$/u.test(path)
);
const productSourceFiles = sourceFiles.filter((path) =>
  /^packages\/(?:cli|engine)\/src\/.*\.ts$/u.test(path)
);

test("authored TypeScript modules stay within the reviewed size boundary", () => {
  const oversized = sourceFiles.flatMap((path) => {
    const text = readFileSync(join(repoRoot, path), "utf8");
    const lineCount = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    return lineCount > 600 ? [`${path}: ${lineCount} lines`] : [];
  });
  assert.deepEqual(oversized, []);
});

test("product source contains no retired or heuristic mechanisms", () => {
  const patterns = [
    ["retired Node module", /@tsonic\/nodejs\//u],
    ["retired generated binding package", /(?:markdig-types|photo-sauce-magic-scaler-types|xunit-types|@tsonic\/tsbindgen)/u],
    ["target-specific primitive module", /@tsonic\/(?:csharp|rust)\/types\.js/u],
    ["target-flavored neutral primitive alias", /\bint32\s+as\s+int\b/u],
    ["retired cast marker", /\b(?:trycast|asinterface|attributes)\s*(?:<|\()/u],
    ["TypeScript source import", /(?:from\s+|import\s*\()\s*["'][^"']+\.ts["']/u],
    ["CommonJS module operation", /\brequire\s*\(|\bmodule\.exports\b|\bexport\s*=/u],
    ["triple-slash reference", /^\s*\/\/\/\s*<reference\b/u],
    ["TypeScript namespace", /^\s*(?:export\s+)?namespace\s+/u],
    ["explicit class accessibility", /^\s*(?:public|private|protected)\s+/u],
    ["TypeScript override modifier", /^\s*override\s+/u],
    ["runtime reflection", /\b(?:System\.Reflection|MethodInfo\.Invoke|Activator\.CreateInstance|Assembly\.Load|GetProperties?\s*\(|GetMethods?\s*\()/u],
    ["unfinished product marker", /\b(?:TODO|FIXME|HACK)\b|\bbest[- ]effort\b|\bFor now\b/u],
  ];
  const violations = [];
  for (const path of sourceFiles) {
    const lines = readFileSync(join(repoRoot, path), "utf8").split("\n");
    for (let index = 0; index < lines.length; index++) {
      for (const [label, pattern] of patterns) {
        if (pattern.test(lines[index])) {
          violations.push(`${path}:${index + 1}: ${label}: ${lines[index].trim()}`);
        }
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("product source does not bypass shared recursive filesystem traversal", () => {
  const violations = productSourceFiles.flatMap((path) => {
    const text = readFileSync(join(repoRoot, path), "utf8");
    return /Directory\.(?:Get|Enumerate)(?:Files|Directories)\(|SearchOption\.AllDirectories/u.test(text)
      ? [`${path}: bypasses shared recursive filesystem traversal`]
      : [];
  });
  assert.deepEqual(violations, []);
});

test("filesystem calls use standard Node option objects", () => {
  const violations = sourceFiles.flatMap((path) => {
    const text = readFileSync(join(repoRoot, path), "utf8");
    return /\b(?:mkdirSync|rmSync)\([^\n,]+,\s*(?:true|false)\s*\)/u.test(text)
      ? [`${path}: uses a provider-private boolean filesystem overload`]
      : [];
  });
  assert.deepEqual(violations, []);
});

test("target-native dependencies stay behind explicit Rust platform boundaries", () => {
  const allowedPlatformFiles = new Set([
    "packages/engine/src/markdown/platform.ts",
    "packages/engine/src/resources/image-provider.ts",
    "packages/engine/src/utils/html.ts",
    "packages/engine/src/utils/text-builder.ts",
    "packages/engine/src/utils/url-components.ts",
  ]);
  const violations = [];
  for (const path of sourceFiles) {
    const text = readFileSync(join(repoRoot, path), "utf8");
    for (const match of text.matchAll(/(?:from\s+|import\s*\()\s*["'](@tsonic\/rust\/[^"']+)["']/gu)) {
      if (
        !allowedPlatformFiles.has(path) ||
        match[1] !== "@tsonic/rust/crates/tsumo_platform/index.js"
      ) {
        violations.push(`${path}: imports ${match[1]} outside a Rust platform boundary`);
      }
    }
    if (
      !allowedPlatformFiles.has(path) &&
      (
        /\b(?:JavaScriptCompiler|MarkdownBatchResult|MarkdownDocument|SassCompiler|TextBuilderState)\b/u.test(text) ||
        /\.(?:add_source|full_source|occurrence_count|occurrence_html|plain_text|replace_html|replace_url|summary_source|table_of_contents|take_result|toc_source)\b/u.test(text)
      )
    ) {
      violations.push(`${path}: references a Rust platform contract outside its boundary`);
    }
  }
  assert.deepEqual(violations, []);
});

test("portable external-tool orchestration uses the Node capability", () => {
  const resources = join(repoRoot, "packages/engine/src/resources");
  const externalProcess = readFileSync(join(resources, "external-process.ts"), "utf8");
  assert.match(externalProcess, /from\s+["']node:child_process["']/u);
  assert.match(externalProcess, /\bspawnSync\s*\(/u);
  for (const fileName of ["sass-provider.ts", "javascript-provider.ts"]) {
    const text = readFileSync(join(resources, fileName), "utf8");
    assert.match(text, /runExternalProcess\s*\(/u, fileName);
    assert.doesNotMatch(
      text,
      /@tsonic\/rust\/|\b(?:SassCompiler|JavaScriptCompiler)\b/u,
      fileName,
    );
  }

  const platform = readFileSync(
    join(repoRoot, "crates/tsumo_platform/src/lib.rs"),
    "utf8",
  );
  assert.doesNotMatch(
    platform,
    /\b(?:SassCompiler|JavaScriptCompiler)\b|\bstd::process\b|\btempfile::/u,
  );
});

test("regular expression helpers use only the shared JavaScript contract", () => {
  const source = readFileSync(
    join(repoRoot, "packages/engine/src/utils/regular-expressions.ts"),
    "utf8",
  );
  assert.match(source, /new RegExp\(/u);
  assert.match(source, /\.matchAll\(/u);
  assert.doesNotMatch(source, /@tsonic\/dotnet\/|@tsonic\/rust\//u);
});

test("compiler projects use one current Rust source and target contract", () => {
  const expectedCrates = new Map([
    ["engine", { crateName: "tsumo_engine", outputType: "lib" }],
    ["cli", { crateName: "tsumo", outputType: "bin" }],
    ["tests", { crateName: "tsumo_tests", outputType: "bin" }],
  ]);

  for (const [projectName, expected] of expectedCrates) {
    const projectRoot = join(repoRoot, "packages", projectName);
    const manifest = readJson(join(projectRoot, "package.json"));
    const config = readJson(join(projectRoot, "tsonic.json"));
    const cargo = readFileSync(join(projectRoot, "Cargo.toml"), "utf8");
    assert.equal(manifest.type, "module", projectName);
    assert.equal(manifest.devDependencies["@tsonic/cli"].startsWith("file:"), true, projectName);
    assert.equal(manifest.devDependencies["@tsonic/target-rust"].startsWith("file:"), true, projectName);
    assert.equal(manifest.devDependencies["@tsonic/rust-nodejs"].startsWith("file:"), true, projectName);
    assert.equal(config.entryPoint.endsWith(".ts"), true, projectName);
    assert.equal(config.rootDir, "src", projectName);
    assert.equal(config.outDir, "out", projectName);
    assert.equal(config.targets.length, 1, projectName);
    assert.equal(config.targets[0].id, "rust", projectName);
    assert.deepEqual(config.targets[0].surfaces, ["js"], projectName);
    assert.equal(config.targets[0].options.crateName, expected.crateName, projectName);
    assert.equal(config.targets[0].options.outputType, expected.outputType, projectName);
    assert.equal(config.targets[0].options.projectFile, "Cargo.toml", projectName);
    assert.match(cargo, new RegExp(`name = "${expected.crateName}"`, "u"), projectName);
    assert.match(cargo, /path = "out\/rust\/src\/lib\.rs"/u, projectName);
  }

  const engineManifest = readJson(join(repoRoot, "packages/engine/package.json"));
  assert.equal(engineManifest.exports["./index.js"], "./src/index.ts");
  assert.equal(engineManifest.exports["."], undefined);
});

test("the Rust workspace owns one lockfile and one native platform boundary", () => {
  const workspace = readFileSync(join(repoRoot, "Cargo.toml"), "utf8");
  for (const member of [
    "crates/tsumo_platform",
    "packages/engine",
    "packages/cli",
    "packages/tests",
  ]) {
    assert.match(workspace, new RegExp(`"${member}"`, "u"));
  }
  assert.equal(repositoryFiles.includes("Cargo.lock"), true);
  assert.deepEqual(repositoryFiles.filter((path) => path.endsWith("Cargo.lock")), ["Cargo.lock"]);

  const platform = readFileSync(join(repoRoot, "crates/tsumo_platform/Cargo.toml"), "utf8");
  for (const dependency of ["html-escape", "image", "linkify", "pulldown-cmark"]) {
    assert.match(platform, new RegExp(`^${dependency}\\s*=`, "mu"));
  }
  assert.doesNotMatch(platform, /^(?:regex|tempfile)\s*=/mu);
});

test("retired C# build and provider infrastructure cannot return", () => {
  const forbiddenFiles = repositoryFiles.filter((path) =>
    path.endsWith(".cs") ||
    path.endsWith(".csproj") ||
    path.endsWith(".slnx") ||
    path.endsWith("packages.lock.json") ||
    path === "scripts/build-dotnet.sh" ||
    path === "scripts/prepare-provider-references.sh" ||
    path.startsWith("packages/markdig/")
  );
  assert.deepEqual(forbiddenFiles, []);

  const contractFiles = repositoryFiles.filter((path) =>
    path === "package.json" ||
    path === "README.md" ||
    path.startsWith("scripts/") ||
    /^packages\/(?:cli|engine|tests)\/(?:package\.json|tsonic\.json|Cargo\.toml)$/u.test(path)
  );
  const violations = contractFiles.flatMap((path) => {
    const text = readFileSync(join(repoRoot, path), "utf8");
    return /(?:target-csharp|csharp-nodejs|\.csproj|dotnet|NativeAOT|provider-reference)/iu.test(text)
      ? [path]
      : [];
  });
  assert.deepEqual(violations, []);
});

test("test inventory contains no disabled cases", () => {
  const testFiles = repositoryFiles.filter((path) =>
    (/^(?:test\/.*\.test\.mjs|packages\/tests\/src\/.*\.test\.ts)$/u.test(path) ||
      /^(?:crates|packages)\/.*\.rs$/u.test(path))
  );
  const violations = testFiles.flatMap((path) => {
    const text = readFileSync(join(repoRoot, path), "utf8");
    return /\b(?:test|it|describe)\.(?:skip|todo)\b|#\s*\[\s*ignore\s*\]/u.test(text)
      ? [path]
      : [];
  });
  assert.deepEqual(violations, []);
});

test("generated and investigation artifacts remain untracked and ignored", () => {
  const forbiddenTracked = repositoryFiles.filter((path) =>
    path.startsWith(".analysis/") ||
    path.startsWith(".temp/") ||
    /(^|\/)public\d*(\/|$)/u.test(path) ||
    /\/(?:out|dist|bin|obj|node_modules|target)\//u.test(`/${path}/`)
  );
  assert.deepEqual(forbiddenTracked, []);
  for (const path of [".analysis/probe.md", ".temp/probe", "packages/engine/out/probe.rs", "target/probe"]) {
    const ignored = execFileSync("git", ["check-ignore", path], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    assert.equal(ignored, path);
  }
});

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
