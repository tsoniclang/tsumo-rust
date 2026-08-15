import { Buffer } from "node:buffer";
import { env } from "node:process";
import { SassCompiler } from "@tsonic/rust/crates/tsumo_platform/index.js";
import { createTsumoError } from "../diagnostics.js";
import { dirExists } from "../fs.js";
import { Resource } from "./models.js";
import { splitResourceFileName, splitResourcePath } from "./paths.js";

export const compileSassResource = (
  resource: Resource,
  loadPaths: string[],
): Resource => {
  if (resource.text === undefined) {
    throw createTsumoError("TSUMO_SASS_TEXT_REQUIRED", "css.Sass requires a text resource");
  }

  const configuredExecutable = env["TSUMO_SASS"];
  const executable = configuredExecutable !== undefined && configuredExecutable !== null && configuredExecutable.trim() !== ""
    ? configuredExecutable.trim()
    : "sass";
  const configuredImplementation = env["TSUMO_SASS_IMPLEMENTATION"];
  const implementation = configuredImplementation === undefined || configuredImplementation === null || configuredImplementation.trim() === ""
    ? "dart-sass"
    : configuredImplementation.trim().toLowerCase();
  if (implementation !== "dart-sass" && implementation !== "libsass") {
    throw createTsumoError(
      "TSUMO_SASS_IMPLEMENTATION_INVALID",
      `Unsupported Sass implementation '${implementation}'; expected 'dart-sass' or 'libsass'`,
    );
  }
  const compiler = new SassCompiler(resource.text, executable, implementation);
  for (let index = 0; index < loadPaths.length; index++) {
    const loadPath = loadPaths[index]!;
    if (dirExists(loadPath)) compiler.add_load_path(loadPath);
  }
  const text = compiler.compile();
  const outputPathRaw = resource.outputRelPath ?? "style.scss";
  const path = splitResourcePath(outputPathRaw);
  const file = splitResourceFileName(path.fileName);
  return new Resource(
    `${resource.id}|sass`,
    resource.sourcePath,
    true,
    path.directory + file.baseName + ".css",
    Buffer.from(text, "utf8"),
    text,
    resource.Data,
    "text/css",
  );
};
