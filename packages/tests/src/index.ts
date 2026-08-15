import { runContentAndMenuTests } from "./content-and-menu.test.js";
import { runDocsDomainTests } from "./docs-domain.test.js";
import { runFilesystemBoundaryTests } from "./filesystem-boundaries.test.js";
import { runInputBoundaryTests } from "./input-boundaries.test.js";
import { runOutputPlanTests } from "./output-plan.test.js";
import { runResourcePipelineTests } from "./resource-pipeline.test.js";
import { runScaffoldAndBuildTests } from "./scaffold-and-build.test.js";
import { runTemplateRuntimeTests } from "./template-runtime.test.js";
import { runThemeCompatibilityTests } from "./theme-compatibility.test.js";
import { completeTests } from "./test-root.js";

export function main(): void {
  runScaffoldAndBuildTests();
  runInputBoundaryTests();
  runFilesystemBoundaryTests();
  runContentAndMenuTests();
  runDocsDomainTests();
  runOutputPlanTests();
  runResourcePipelineTests();
  runTemplateRuntimeTests();
  runThemeCompatibilityTests();
  completeTests(63);
  return;
}
