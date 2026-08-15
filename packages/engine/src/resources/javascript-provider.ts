import { Buffer } from "node:buffer";
import { env } from "node:process";
import { JavaScriptCompiler } from "@tsonic/rust/crates/tsumo_platform/index.js";
import { createTsumoError } from "../diagnostics.js";
import { Resource } from "./models.js";
import { splitResourceFileName, splitResourcePath } from "./paths.js";
import { readResourceText } from "./text.js";

const cacheKeyPart = (value: string): string => `${value.length}:${value}`;

export class JavaScriptBuildOptions {
  targetPath: string | undefined;
  minify: boolean;
  format: string;
  target: string;
  platform: string;
  sourceMap: string;
  paramsJson: string | undefined;
  jsxFactory: string | undefined;

  constructor() {
    this.targetPath = undefined;
    this.minify = false;
    this.format = "iife";
    this.target = "esnext";
    this.platform = "browser";
    this.sourceMap = "none";
    this.paramsJson = undefined;
    this.jsxFactory = undefined;
  }

  cacheKey(): string {
    const values = [
      this.targetPath ?? "",
      this.minify ? "1" : "0",
      this.format,
      this.target,
      this.platform,
      this.sourceMap,
      this.paramsJson ?? "",
      this.jsxFactory ?? "",
    ];
    let result = "";
    for (let index = 0; index < values.length; index++) {
      result += cacheKeyPart(values[index]!);
    }
    return result;
  }
}

const sourceExtension = (resource: Resource): string => {
  const raw = resource.outputRelPath ?? resource.sourcePath ?? "input.js";
  const extension = splitResourceFileName(splitResourcePath(raw).fileName).extension.toLowerCase();
  if (extension === ".ts" || extension === ".tsx" || extension === ".jsx") return extension;
  return ".js";
};

const outputRelativePath = (resource: Resource, options: JavaScriptBuildOptions): string => {
  const raw = options.targetPath ?? resource.outputRelPath ?? "script.js";
  const path = splitResourcePath(raw);
  const file = splitResourceFileName(path.fileName);
  return path.directory + file.baseName + ".js";
};

export const buildJavaScriptResource = (
  resource: Resource,
  options: JavaScriptBuildOptions,
): Resource => {
  const sourceText = readResourceText(resource, "js.Build");
  if (options.sourceMap !== "none") {
    throw createTsumoError(
      "TSUMO_JAVASCRIPT_SOURCE_MAP_UNSUPPORTED",
      "js.Build currently supports only sourceMap 'none'",
    );
  }

  const configuredExecutable = env["TSUMO_ESBUILD"];
  const executable = configuredExecutable !== undefined && configuredExecutable !== null && configuredExecutable.trim() !== ""
    ? configuredExecutable.trim()
    : "esbuild";
  const compiler = new JavaScriptCompiler(
    sourceText,
    executable,
    resource.sourcePath ?? "",
    sourceExtension(resource),
  );
  compiler.set_minify(options.minify);
  compiler.set_format(options.format);
  compiler.set_target(options.target);
  compiler.set_platform(options.platform);
  const paramsJson = options.paramsJson;
  if (paramsJson !== undefined) compiler.set_params_json(paramsJson);
  const jsxFactory = options.jsxFactory;
  if (jsxFactory !== undefined) compiler.set_jsx_factory(jsxFactory);
  const text = compiler.compile();
  return new Resource(
    `${resource.id}|js-build:${options.cacheKey()}`,
    resource.sourcePath,
    true,
    outputRelativePath(resource, options),
    Buffer.from(text, "utf8"),
    text,
    resource.Data,
    "application/javascript",
  );
};
