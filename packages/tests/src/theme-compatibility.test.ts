import { join } from "node:path";

import {
  DateValue,
  loadSiteData,
  ModuleMount,
  PageValue,
  parseTemplate,
} from "@tsumo/engine/testing.js";
import {
  Assert,
  createDirectory,
  createTestDirectory,
  deleteTestDirectory,
  runTest,
  writeTextFile,
} from "./test-root.js";
import {
  captureDiagnosticCode,
  createPage,
  createSite,
  render,
  renderWithRoot,
  TestTemplateEnvironment,
} from "./template-test-harness.js";

export class ThemeCompatibilityTests {
  chained_alternatives_preserve_the_selected_context(): void {
    Assert.StringEqual(
      "second|selected|fallback",
      render(
        "{{ if false }}first{{ else if true }}second{{ else }}third{{ end }}|" +
        "{{ with nil }}first{{ else with \"selected\" }}{{ . }}{{ else }}third{{ end }}|" +
        "{{ with nil }}first{{ else with nil }}second{{ else }}fallback{{ end }}",
      ),
    );
    Assert.StringEqual(
      "2026-08-15T00:00:00Z|2026-08-15T00:00:00Z",
      renderWithRoot(
        "{{ time . }}|{{ time.AsTime . }}",
        new DateValue("2026-08-15T00:00:00Z"),
      ),
    );
    Assert.StringEqual(
      "TSUMO_TEMPLATE_TIME_INVALID",
      captureDiagnosticCode(() => {
        render("{{ time \"not-a-date\" }}");
      }),
    );
  }

  where_filters_structured_slices_and_rejects_unproven_inputs(): void {
    Assert.StringEqual(
      "one,three,|two,",
      render(
        "{{ $items := slice (dict \"kind\" \"x\" \"name\" \"one\") " +
        "(dict \"kind\" \"y\" \"name\" \"two\") (dict \"kind\" \"x\" \"name\" \"three\") }}" +
        "{{ range where $items \"kind\" \"x\" }}{{ .name }},{{ end }}|" +
        "{{ range where $items \"kind\" \"ne\" \"x\" }}{{ .name }},{{ end }}",
      ),
    );
    Assert.StringEqual(
      "TSUMO_TEMPLATE_WHERE_COLLECTION_UNSUPPORTED",
      captureDiagnosticCode(() => {
        render("{{ where \"scalar\" \"\" \"scalar\" }}");
      }),
    );
    Assert.StringEqual(
      "TSUMO_TEMPLATE_WHERE_OPERATOR_UNSUPPORTED",
      captureDiagnosticCode(() => {
        render("{{ where (slice \"value\") \"\" \"approximately\" \"value\" }}");
      }),
    );
  }

  site_data_layers_are_structured_deterministic_and_conflict_checked(): void {
    const root = createTestDirectory("theme-data-layers");
    const siteDirectory = join(root, "site");
    const themeDirectory = join(root, "theme");
    const mountDirectory = join(root, "module-data");
    try {
      createDirectory(join(siteDirectory, "data"));
      createDirectory(join(themeDirectory, "data", "nested"));
      createDirectory(mountDirectory);
      writeTextFile(join(themeDirectory, "data", "theme.toml"), "value = \"theme\"\n");
      writeTextFile(join(themeDirectory, "data", "shared.toml"), "value = \"theme\"\n");
      writeTextFile(join(themeDirectory, "data", "nested", "entry.json"), "{\"value\":\"nested\"}");
      writeTextFile(join(mountDirectory, "module.json"), "{\"value\":\"module\"}");
      writeTextFile(join(mountDirectory, "shared.json"), "{\"value\":\"module\"}");
      writeTextFile(join(siteDirectory, "data", "site.yaml"), "value: site\n");
      writeTextFile(join(siteDirectory, "data", "shared.yaml"), "value: site\n");

      const data = loadSiteData(
        siteDirectory,
        themeDirectory,
        [new ModuleMount(mountDirectory, "data")],
      );
      const environment = new TestTemplateEnvironment();
      environment.setSiteData(data);
      const site = createSite();
      const page = createPage(site, "Home", "", "home");
      const template = parseTemplate(
        "{{ hugo.Data.theme.value }}|{{ hugo.Data.module.value }}|" +
        "{{ .Site.Data.shared.value }}|{{ hugo.Data.nested.entry.value }}",
      );
      Assert.StringEqual(
        "theme|module|site|nested",
        environment.renderTemplate(template, new PageValue(page), site, new Map()),
      );

      writeTextFile(join(siteDirectory, "data", "shared.toml"), "value = \"duplicate\"\n");
      Assert.StringEqual(
        "TSUMO_DATA_IDENTITY_CONFLICT",
        captureDiagnosticCode(() => {
          loadSiteData(siteDirectory, themeDirectory, [new ModuleMount(mountDirectory, "data")]);
        }),
      );
    } finally {
      deleteTestDirectory(root);
    }
  }
}

export const runThemeCompatibilityTests = (): void => {
  const tests = new ThemeCompatibilityTests();
  runTest("chained alternatives preserve the selected context", () => {
    tests.chained_alternatives_preserve_the_selected_context();
  });
  runTest("where filters structured slices and rejects unproven inputs", () => {
    tests.where_filters_structured_slices_and_rejects_unproven_inputs();
  });
  runTest("site data layers are structured, deterministic, and conflict checked", () => {
    tests.site_data_layers_are_structured_deterministic_and_conflict_checked();
  });
};
