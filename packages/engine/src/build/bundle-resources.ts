import { basename, join } from "node:path";
import { fileExists, listDirectoriesTopDirectory, listFilesTopDirectory } from "../fs.js";
import { SiteOutputPlan } from "./output-plan.js";
import { compareSitePaths } from "./site-routes.js";

const isBundleDirectory = (directory: string): boolean =>
  fileExists(join(directory, "index.md")) || fileExists(join(directory, "_index.md"));

export const addBundleResources = (
  sourceDir: string,
  outputPrefix: string,
  owner: string,
  outputPlan: SiteOutputPlan,
): void => {
  const files = listFilesTopDirectory(sourceDir, "*");
  files.sort((left: string, right: string) => compareSitePaths(left, right));
  for (let index = 0; index < files.length; index++) {
    const sourceFile = files[index]!;
    if (sourceFile.toLowerCase().endsWith(".md")) continue;
    const name = basename(sourceFile);
    if (name === "") continue;
    const outputPath = outputPrefix === "" ? name : outputPrefix + "/" + name;
    outputPlan.addAsset(outputPath, sourceFile, owner, "bundle");
  }

  const directories = listDirectoriesTopDirectory(sourceDir);
  directories.sort((left: string, right: string) => compareSitePaths(left, right));
  for (let index = 0; index < directories.length; index++) {
    const child = directories[index]!;
    if (isBundleDirectory(child)) continue;
    if (listFilesTopDirectory(child, "*.md").length > 0) continue;
    const name = basename(child);
    if (name === "") continue;
    const childPrefix = outputPrefix === "" ? name : outputPrefix + "/" + name;
    addBundleResources(child, childPrefix, owner, outputPlan);
  }
};
