import { Buffer } from "node:buffer";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import type { int32 as int } from "@tsonic/core/types.js";
import { resize_image } from "@tsonic/rust/crates/tsumo_platform/index.js";
import { createTsumoError } from "../diagnostics.js";
import { parseInt32 } from "../utils/int32.js";
import { parseImageDimensions } from "./image-dimensions.js";
import { resourceMediaTypeForExtension } from "./media-types.js";
import { Resource, ResourceData } from "./models.js";
import { splitResourceFileName, splitResourcePath } from "./paths.js";

class ImageResizeRequest {
  width: int;
  height: int;
  format: string | undefined;

  constructor(width: int, height: int, format: string | undefined) {
    this.width = width;
    this.height = height;
    this.format = format;
  }
}

const parsePositiveDimension = (value: string, spec: string): int => {
  if (value === "") return 0;
  const parsed = parseInt32(value);
  if (parsed === undefined || parsed <= 0) {
    throw createTsumoError("TSUMO_IMAGE_RESIZE_SPEC_INVALID", `Invalid image resize specification: ${spec}`);
  }
  return parsed;
};

const parseImageResizeRequest = (spec: string): ImageResizeRequest => {
  const tokens = spec.trim().toLowerCase().split(" ").filter((token: string) => token !== "");
  if (tokens.length === 0) {
    throw createTsumoError("TSUMO_IMAGE_RESIZE_SPEC_INVALID", "Image resize specification cannot be empty");
  }

  const dimensions = tokens[0]!;
  const separator = dimensions.indexOf("x");
  let width: int;
  let height: int;
  if (separator < 0) {
    width = parsePositiveDimension(dimensions, spec);
    height = 0;
  } else {
    width = parsePositiveDimension(dimensions.slice(0, separator), spec);
    height = parsePositiveDimension(dimensions.slice(separator + 1), spec);
  }
  if (width === 0 && height === 0) {
    throw createTsumoError("TSUMO_IMAGE_RESIZE_SPEC_INVALID", `Invalid image resize specification: ${spec}`);
  }

  let format: string | undefined = undefined;
  for (let index = 1; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token === "jpg" || token === "jpeg" || token === "png" || token === "gif" || token === "webp") {
      if (format !== undefined) {
        throw createTsumoError("TSUMO_IMAGE_RESIZE_SPEC_INVALID", `Image resize format is specified more than once: ${spec}`);
      }
      format = token === "jpeg" ? "jpg" : token;
      continue;
    }
    throw createTsumoError("TSUMO_IMAGE_RESIZE_OPTION_UNSUPPORTED", `Unsupported image resize option '${token}'`);
  }
  return new ImageResizeRequest(width, height, format);
};

export const resizeImageResource = (resource: Resource, specification: string): Resource => {
  const request = parseImageResizeRequest(specification);
  let width: int = request.width;
  let height: int = request.height;
  if (width === 0 && resource.width > 0 && resource.height > 0) {
    width = (resource.width * height) / resource.height;
  } else if (height === 0 && resource.width > 0 && resource.height > 0) {
    height = (resource.height * width) / resource.width;
  }
  if (width <= 0 || height <= 0) {
    throw createTsumoError(
      "TSUMO_IMAGE_DIMENSIONS_UNKNOWN",
      "Image resizing with one automatic dimension requires known source dimensions",
    );
  }

  const sourceName = resource.outputRelPath ?? resource.sourcePath ?? "";
  const sourceExtension = extname(sourceName).toLowerCase();
  if (sourceExtension === "") {
    throw createTsumoError("TSUMO_IMAGE_FORMAT_UNKNOWN", "Image resizing requires a source file format");
  }
  const outputExtension = request.format === undefined ? sourceExtension : `.${request.format}`;
  const workDirectory = mkdtempSync(join(tmpdir(), "tsumo-image-"));

  try {
    const inputPath = join(workDirectory, "input" + sourceExtension);
    const outputPath = join(workDirectory, "output" + outputExtension);
    writeFileSync(inputPath, resource.bytes);
    resize_image(inputPath, outputPath, width, height, outputExtension.slice(1));

    const outputBytes = readFileSync(outputPath);
    let outputWidth: int = width;
    let outputHeight: int = height;
    const dimensions = parseImageDimensions(outputBytes);
    if (dimensions !== undefined) {
      outputWidth = dimensions.width;
      outputHeight = dimensions.height;
    }

    const outputRelPath = resource.outputRelPath ?? "";
    const path = splitResourcePath(outputRelPath);
    const file = splitResourceFileName(path.fileName);
    const outputFile = `${file.baseName}_${outputWidth}x${outputHeight}${outputExtension}`;
    return new Resource(
      `${resource.id}|resize:${specification}`,
      undefined,
      true,
      path.directory + outputFile,
      outputBytes,
      undefined,
      new ResourceData(""),
      resourceMediaTypeForExtension(outputExtension),
      outputWidth,
      outputHeight,
    );
  } finally {
    rmSync(workDirectory, true);
  }
};
