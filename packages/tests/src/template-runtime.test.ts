import { join } from "node:path";

import {
  collectShortcodeNames,
  DictValue,
  I18nStore,
  PageValue,
  parseShortcodes,
  parseTemplate,
  ResourceManager,
  StringValue,
  TemplateValue,
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
  captureDiagnostic, captureDiagnosticCode, createPage, createSite, render, renderWithRoot,
  TestTemplateEnvironment,
} from "./template-test-harness.js";

export class TemplateRuntimeTests {
  parser_and_evaluator_render_control_flow_and_pipeline(): void {
    const source = "{{ if true }}yes{{ else }}no{{ end }}|{{ \"ab\" | upper }}";
    Assert.StringEqual("yes|AB", render(source));
    const site = createSite();
    const page = createPage(site, "Home", "", "home");
    Assert.StringEqual(
      "false|exact",
      renderWithRoot(
        "{{ in (slice \"posts\" \"tags\") .Section }}|{{ (dict \"value\" \"exact\").value }}",
        new PageValue(page),
      ),
    );
    Assert.StringEqual(
      "inner|outer|empty|chosen:chosen|changed|changed",
      render(
        "{{ $value := \"outer\" }}" +
        "{{ if $value := \"inner\" }}{{ $value }}{{ end }}|{{ $value }}|" +
        "{{ with $selected := \"\" }}invalid{{ else }}{{ if eq $selected \"\" }}empty{{ end }}{{ end }}|" +
        "{{ with $selected := \"chosen\" }}{{ $selected }}:{{ . }}{{ end }}|" +
        "{{ if $value = \"changed\" }}{{ $value }}{{ end }}|{{ $value }}",
      ),
    );
  }

  collection_functions_preserve_exact_split_segments(): void {
    Assert.StringEqual("a|b|", render("{{ delimit (split \"a--b--\" \"--\") \"|\" }}"));
    Assert.StringEqual("a|b", render("{{ delimit (split \"ab\" \"\") \"|\" }}"));
  }

  collection_union_accepts_slices_and_nil_without_collapsing_distinct_values(): void {
    Assert.StringEqual(
      "a,b,c|a,b|a,b|",
      render(
        "{{ delimit (union (slice \"a\" \"b\") (slice \"b\" \"c\")) \",\" }}|" +
        "{{ delimit (union (slice \"a\" \"b\") nil) \",\" }}|" +
        "{{ delimit (union nil (slice \"a\" \"b\")) \",\" }}|" +
        "{{ delimit (union nil nil) \",\" }}",
      ),
    );
    Assert.StringEqual(
      "one,three",
      render("{{ delimit (collections.Complement (slice \"two\") (slice \"one\" \"two\" \"three\")) \",\" }}"),
    );
  }

  page_has_shortcode_uses_the_exact_parsed_page_inventory(): void {
    const site = createSite();
    const page = createPage(site, "Home", "", "home");
    page.shortcodeNames = collectShortcodeNames(
      "{{< outer >}}{{< inner / >}}{{< /outer >}}\n```text\n{{< ignored >}}\n```",
      "content/home.md",
    );
    Assert.StringEqual(
      "true|true|false|false",
      renderWithRoot(
        "{{ .HasShortcode \"outer\" }}|{{ .HasShortcode \"inner\" }}|" +
        "{{ .HasShortcode \"ignored\" }}|{{ .HasShortcode \"Outer\" }}",
        new PageValue(page),
      ),
    );
  }

  hugo_sites_exposes_the_checked_site_graph(): void {
    const environment = new TestTemplateEnvironment();
    const site = createSite();
    const root = createPage(site, "Home", "", "home");
    site.home = root;
    site.Sites = [site];
    const template = parseTemplate(
      "{{ range hugo.Sites }}{{ .Title }};{{ end }}|{{ hugo.Sites.Default.Home.RelPermalink }}",
    );
    Assert.StringEqual(
      "Test Site;|/home/",
      environment.renderTemplate(template, new PageValue(root), site, new Map()),
    );
  }

  related_pages_use_exact_default_keyword_and_tag_evidence(): void {
    const environment = new TestTemplateEnvironment();
    const site = createSite();
    const current = createPage(site, "Current", "2026-08-15T00:00:00Z", "page");
    const older = createPage(site, "Older", "2025-08-15T00:00:00Z", "page");
    const newer = createPage(site, "Newer", "2027-08-15T00:00:00Z", "page");
    const unrelated = createPage(site, "Unrelated", "2024-08-15T00:00:00Z", "page");
    current.tags = ["shared"];
    older.tags = ["shared"];
    newer.tags = ["shared"];
    unrelated.tags = ["other"];
    site.allPages = [current, older, newer, unrelated];
    const template = parseTemplate("{{ range site.RegularPages.Related page }}{{ .Title }}{{ end }}");
    Assert.StringEqual(
      "Older",
      environment.renderTemplate(template, new PageValue(current), site, new Map()),
    );
  }

  css_build_applies_its_closed_resource_options(): void {
    const root = createTestDirectory("template-css-build");
    const siteDirectory = join(root, "site");
    const outputDirectory = join(root, "output");
    try {
      createDirectory(siteDirectory);
      const manager = new ResourceManager(siteDirectory, undefined, outputDirectory);
      const environment = new TestTemplateEnvironment(manager);
      const site = createSite();
      const page = createPage(site, "Home", "", "home");
      const template = parseTemplate(
        "{{ $style := resources.FromString \"theme.css\" \"body { color: red; }\\n\" }}" +
        "{{ $style = $style | css.Build (dict \"targetPath\" \"css/main.css\" \"minify\" true \"sourceMap\" \"none\") }}" +
        "{{ $style.RelPermalink }}|{{ $style.Content }}",
      );
      Assert.StringEqual(
        "/css/main.css|body { color: red; }",
        environment.renderTemplate(template, new PageValue(page), site, new Map()),
      );
      const namespaceTemplate = parseTemplate(
        "{{ $namespace := resources }}" +
        "{{ $copy := $namespace.FromString \"css/copy.css\" \"p { color: blue; }\" }}" +
        "{{ $copy.RelPermalink }}|{{ $copy.Content }}",
      );
      Assert.StringEqual(
        "/css/copy.css|p { color: blue; }",
        environment.renderTemplate(namespaceTemplate, new PageValue(page), site, new Map()),
      );
    } finally {
      deleteTestDirectory(root);
    }
  }

  i18n_layers_parse_structured_formats_and_render_plural_context(): void {
    const root = createTestDirectory("template-i18n");
    const themeDirectory = join(root, "theme");
    const siteDirectory = join(root, "site");
    try {
      createDirectory(themeDirectory);
      createDirectory(siteDirectory);
      writeTextFile(
        join(themeDirectory, "en.toml"),
        "toggleMenu = \"Theme Menu\"\n" +
        "[footer]\n" +
        "builtWith = \"Built with {{ .Generator }}\"\n" +
        "[list.page]\n" +
        "one = \"{{ .Count }} page\"\n" +
        "other = \"{{ .Count }} pages\"\n",
      );
      writeTextFile(
        join(themeDirectory, "fr.json"),
        "{\"local\":\"Locale française\"}",
      );
      writeTextFile(
        join(siteDirectory, "en.yaml"),
        "- id: toggleMenu # site override\n" +
        "  translation: Site Menu\n" +
        "- id: legacy\n" +
        "  translation: Legacy {{ .Name }}\n" +
        "- id: continued\n" +
        "  translation:\n" +
        "    \"Continued scalar\"\n" +
        "- id: folded\n" +
        "  translation: >-\n" +
        "    Folded\n" +
        "    scalar\n" +
        "- id: literal\n" +
        "  translation: |\n" +
        "    Literal\n" +
        "    scalar\n" +
        "- id: escapedQuoted\n" +
        "  translation:\n" +
        "    \"Generated with " + "\\" + "\n" +
        "    exact continuity.\"\n" +
        "- id: foldedQuoted\n" +
        "  translation: \"Folded\n" +
        "  quoted scalar\"\n" +
        "- id: singleQuoted\n" +
        "  translation:\n" +
        "    'Single\n" +
        "    quoted ''value'''\n" +
        "- id: plainWithQuotes\n" +
        "  translation: Tagged '{{ . }}'\n",
      );

      const store = new I18nStore();
      store.loadFromDir(themeDirectory);
      store.loadFromDir(siteDirectory);
      Assert.StringEqual("Site Menu", store.translate("en-US", "toggleMenu"));
      Assert.StringEqual("{{ .Count }} page", store.translate("en", "list.page", 1));
      Assert.StringEqual("{{ .Count }} pages", store.translate("en", "list.page", 2));
      Assert.StringEqual("Locale française", store.translate("fr-FR", "local"));
      Assert.StringEqual("Folded scalar", store.translate("en", "folded"));
      Assert.StringEqual("Literal\nscalar\n", store.translate("en", "literal"));
      Assert.StringEqual("Generated with exact continuity.", store.translate("en", "escapedQuoted"));
      Assert.StringEqual("Folded quoted scalar", store.translate("en", "foldedQuoted"));
      Assert.StringEqual("Single quoted 'value'", store.translate("en", "singleQuoted"));
      Assert.StringEqual("Tagged '{{ . }}'", store.translate("en", "plainWithQuotes"));

      const environment = new TestTemplateEnvironment();
      environment.i18nStore = store;
      const site = createSite();
      const page = createPage(site, "Home", "", "home");
      const template = parseTemplate(
        "{{ T \"toggleMenu\" }}|" +
        "{{ T \"footer.builtWith\" (dict \"Generator\" \"<strong>Tsumo</strong>\") | safeHTML }}|" +
        "{{ T \"list.page\" 1 }}|{{ T \"list.page\" 2 }}|" +
        "{{ T \"legacy\" (dict \"Name\" \"Ada\") }}|{{ T \"continued\" }}",
      );
      Assert.StringEqual(
        "Site Menu|Built with <strong>Tsumo</strong>|1 page|2 pages|Legacy Ada|Continued scalar",
        environment.renderTemplate(template, new PageValue(page), site, new Map()),
      );
    } finally {
      deleteTestDirectory(root);
    }
  }

  deferred_templates_finalize_after_normal_render_and_share_keyed_results(): void {
    const environment = new TestTemplateEnvironment();
    const site = createSite();
    const page = createPage(site, "Home", "", "home");
    const template = parseTemplate(
      "{{ with (templates.Defer (dict \"key\" \"shared\")) }}" +
      "{{ site.Store.Add \"runs\" 1 }}{{ site.Store.Get \"late\" }}{{ end }}" +
      "{{ site.Store.Set \"late\" \"ready\" }}",
      "layouts/baseof.html",
    );
    let first = environment.renderTemplate(template, new PageValue(page), site, new Map());
    let second = environment.renderTemplate(template, new PageValue(page), site, new Map());
    const results = environment.finalizeDeferredTemplates();
    for (const token of results.keys()) {
      const result = results.get(token);
      if (result === undefined) throw new Error("Expected a finalized deferred-template result");
      first = first.replaceAll(token, result);
      second = second.replaceAll(token, result);
    }
    Assert.StringEqual("ready", first);
    Assert.StringEqual("ready", second);
    Assert.StringEqual(
      "1",
      environment.renderTemplate(parseTemplate("{{ site.Store.Get \"runs\" }}"), new PageValue(page), site, new Map()),
    );
  }

  deferred_templates_distinguish_authored_occurrences_with_the_same_key(): void {
    const environment = new TestTemplateEnvironment();
    const site = createSite();
    const page = createPage(site, "Home", "", "home");
    const template = parseTemplate(
      "{{ with (templates.Defer (dict \"key\" \"shared\")) }}first{{ end }}|" +
      "{{ with (templates.Defer (dict \"key\" \"shared\")) }}second{{ end }}",
      "layouts/distinct-deferred.html",
    );
    let output = environment.renderTemplate(template, new PageValue(page), site, new Map());
    const results = environment.finalizeDeferredTemplates();
    Assert.NumberEqual(2, results.size);
    for (const token of results.keys()) {
      const result = results.get(token);
      if (result === undefined) throw new Error("Expected a finalized deferred-template result");
      output = output.replaceAll(token, result);
    }
    Assert.StringEqual("first|second", output);
  }

  return_evaluates_its_complete_value_expression(): void {
    const environment = new TestTemplateEnvironment();
    environment.templates.set(
      "partials/selection",
      parseTemplate("{{ return cond true \"selected\" \"rejected\" }}", "partials/selection"),
    );
    const site = createSite();
    const root = createPage(site, "Home", "", "home");
    const parent = parseTemplate("{{ partial \"selection\" . }}", "partials/parent");
    Assert.StringEqual(
      "selected",
      environment.renderTemplate(parent, new PageValue(root), site, new Map()),
    );
  }

  template_string_literals_decode_exact_interpreted_and_raw_forms(): void {
    Assert.StringEqual("line\nnext", render("{{ print \"line\\nnext\" }}"));
    Assert.StringEqual("line\\nnext", render("{{ print `line\\nnext` }}"));
    Assert.StringEqual("\u001b", render("{{ print \"\\033\" }}"));
    Assert.StringEqual("🔗", render("{{ print \"\\U0001F517\" }}"));
    Assert.StringEqual(
      "TSUMO_TEMPLATE_STRING_ESCAPE_INVALID",
      captureDiagnosticCode(() => {
        render("{{ print \"\\q\" }}");
      }),
    );
  }

  template_text_compatibility_functions_are_deterministic(): void {
    Assert.StringEqual("a-b---c", render("{{ anchorize \"a b   c\" }}"));
    Assert.StringEqual("-a-b--c-", render("{{ anchorize \"< a, b, & c >\" }}"));
    Assert.StringEqual("maingo|hugö", render("{{ anchorize \"main.go\" }}|{{ anchorize \"Hugö\" }}"));
    Assert.StringEqual("I ❤️ Tsumo :unknown:", render("{{ emojify \"I :heart: Tsumo :unknown:\" }}"));
  }

  template_regular_expression_functions_preserve_matches_groups_and_limits(): void {
    Assert.StringEqual("ab,ac", render("{{ delimit (findRE `a.` `ab ac ad` 2) `,` }}"));
    Assert.StringEqual(
      "item42|item|42|item|42",
      render(
        "{{ range findRESubmatch `([a-z]+)([0-9]+)` `item42` }}" +
        "{{ delimit . `|` }}|{{ index . 1 }}|{{ index . 2 }}{{ end }}",
      ),
    );
    Assert.StringEqual("x2 item3", render("{{ replaceRE `item` `x` `item2 item3` 1 }}"));
  }

  template_scanning_preserves_unicode_scalars_and_utf16_locations(): void {
    Assert.StringEqual("before 🔗 after", render("before 🔗 after"));
    Assert.StringEqual("🔗", render("{{ print \"🔗\" }}"));
    Assert.StringEqual("🔗", render("{{ \"<span>🔗</span>\" | plainify }}"));

    const located = captureDiagnostic(() => {
      parseTemplate("🔗{{ if true", "layouts/unicode.html");
    });
    Assert.StringEqual("TSUMO_TEMPLATE_ACTION_UNCLOSED", located.code);
    Assert.NumberEqual(1, located.line);
    Assert.NumberEqual(3, located.column);

    const largeTemplateLines: string[] = [];
    for (let index = 0; index < 2000; index++) {
      largeTemplateLines.push(`line ${index}: {{ print \"${index}\" }}`);
    }
    Assert.True(parseTemplate(largeTemplateLines.join("\n"), "layouts/large.html") !== undefined);
  }

  dictionary_range_order_is_deterministic(): void {
    const source = "{{ range $key, $value := dict \"z\" \"last\" \"a\" \"first\" }}{{$key}}={{$value}};{{end}}";
    Assert.StringEqual("a=first;z=last;", render(source));
    Assert.StringEqual("a=first;z=last;", render(source));
  }

  parser_reports_exact_malformed_input_diagnostics(): void {
    Assert.StringEqual(
      "TSUMO_TEMPLATE_ACTION_UNCLOSED",
      captureDiagnosticCode(() => {
        parseTemplate("before {{ if true");
      }),
    );
    Assert.StringEqual(
      "TSUMO_TEMPLATE_STRING_UNCLOSED",
      captureDiagnosticCode(() => {
        parseTemplate("{{ print \"unterminated }}");
      }),
    );
    Assert.StringEqual(
      "TSUMO_TEMPLATE_BLOCK_UNCLOSED",
      captureDiagnosticCode(() => {
        parseTemplate("{{ if true }}body");
      }),
    );
    Assert.StringEqual(
      "TSUMO_TEMPLATE_DEFINE_DUPLICATE",
      captureDiagnosticCode(() => {
        parseTemplate("{{ define \"x\" }}a{{ end }}{{ define \"x\" }}b{{ end }}");
      }),
    );

    const located = captureDiagnostic(() => {
      parseTemplate("first\n{{ if true", "layouts/single.html");
    });
    Assert.StringEqual("TSUMO_TEMPLATE_ACTION_UNCLOSED", located.code);
    Assert.StringEqual("layouts/single.html", located.file);
    Assert.NumberEqual(2, located.line);
    Assert.NumberEqual(1, located.column);
  }

  shortcode_parser_rejects_ambiguous_input_with_exact_locations(): void {
    const unclosed = captureDiagnostic(() => {
      parseShortcodes("first\n{{< figure", "content/post.md");
    });
    Assert.StringEqual("TSUMO_SHORTCODE_ACTION_UNCLOSED", unclosed.code);
    Assert.StringEqual("content/post.md", unclosed.file);
    Assert.NumberEqual(2, unclosed.line);
    Assert.NumberEqual(1, unclosed.column);

    Assert.StringEqual(
      "TSUMO_SHORTCODE_PARAMETER_DUPLICATE",
      captureDiagnosticCode(() => {
        parseShortcodes("{{< figure src='one' src='two' >}}", "content/post.md");
      }),
    );
    Assert.StringEqual(
      "TSUMO_SHORTCODE_PARAMETER_STYLE_MIXED",
      captureDiagnosticCode(() => {
        parseShortcodes("{{< figure 'one' src='two' >}}", "content/post.md");
      }),
    );

    const quoted = parseShortcodes("{{< figure caption=\"\" published=\"true\" count=2 >}}", "content/post.md");
    Assert.NumberEqual(1, quoted.length);
    Assert.StringEqual("", quoted[0]!.params.get("caption")?.stringValue);
    Assert.StringEqual("true", quoted[0]!.params.get("published")?.stringValue);
    Assert.NumberEqual(2, quoted[0]!.params.get("count")?.numberValue);
  }

  evaluator_reports_exact_unknown_and_invalid_operations(): void {
    Assert.StringEqual(
      "TSUMO_TEMPLATE_UNKNOWN_FUNCTION",
      captureDiagnosticCode(() => {
        render("{{ imaginary \"x\" }}");
      }),
    );
    Assert.StringEqual(
      "TSUMO_TEMPLATE_FUNCTION_ARGUMENTS_INVALID",
      captureDiagnosticCode(() => {
        render("{{ div 1 }}");
      }),
    );
    Assert.StringEqual(
      "TSUMO_TEMPLATE_DIVIDE_BY_ZERO",
      captureDiagnosticCode(() => {
        render("{{ div 4 0 }}");
      }),
    );
    Assert.StringEqual(
      "TSUMO_TEMPLATE_MODULO_BY_ZERO",
      captureDiagnosticCode(() => {
        render("{{ mod 4 0 }}");
      }),
    );
    Assert.StringEqual(
      "TSUMO_TEMPLATE_PARTIAL_MISSING",
      captureDiagnosticCode(() => {
        render("{{ partial \"absent\" . }}");
      }),
    );
    Assert.StringEqual(
      "TSUMO_TEMPLATE_METHOD_UNKNOWN",
      captureDiagnosticCode(() => {
        render("{{ (\"value\").Missing \"argument\" }}");
      }),
    );
    Assert.StringEqual(
      "TSUMO_TEMPLATE_METHOD_UNKNOWN",
      captureDiagnosticCode(() => {
        render("{{ $value := slice \"item\" }}{{ $value.Missing \"argument\" }}");
      }),
    );
  }

  dictionary_values_are_resolved_without_name_fallbacks(): void {
    const values = new Map<string, TemplateValue>();
    values.set("message", new StringValue("exact"));
    Assert.StringEqual("exact", renderWithRoot("{{ .message }}", new DictValue(values)));
  }
}

export const runTemplateRuntimeTests = (): void => {
  const tests = new TemplateRuntimeTests();
  runTest("parser and evaluator render control flow and pipeline", () => {
    tests.parser_and_evaluator_render_control_flow_and_pipeline();
  });
  runTest("collection functions preserve exact split segments", () => {
    tests.collection_functions_preserve_exact_split_segments();
  });
  runTest("collection union accepts slices and nil without collapsing distinct values", () => {
    tests.collection_union_accepts_slices_and_nil_without_collapsing_distinct_values();
  });
  runTest("page HasShortcode uses the exact parsed page inventory", () => {
    tests.page_has_shortcode_uses_the_exact_parsed_page_inventory();
  });
  runTest("return evaluates its complete value expression", () => {
    tests.return_evaluates_its_complete_value_expression();
  });
  runTest("hugo Sites exposes the checked site graph", () => {
    tests.hugo_sites_exposes_the_checked_site_graph();
  });
  runTest("related pages use exact default keyword and tag evidence", () => {
    tests.related_pages_use_exact_default_keyword_and_tag_evidence();
  });
  runTest("css Build applies its closed resource options", () => {
    tests.css_build_applies_its_closed_resource_options();
  });
  runTest("i18n layers parse structured formats and render plural context", () => {
    tests.i18n_layers_parse_structured_formats_and_render_plural_context();
  });
  runTest("deferred templates finalize after normal render and share keyed results", () => {
    tests.deferred_templates_finalize_after_normal_render_and_share_keyed_results();
  });
  runTest("deferred templates distinguish authored occurrences with the same key", () => {
    tests.deferred_templates_distinguish_authored_occurrences_with_the_same_key();
  });
  runTest("template string literals decode exact interpreted and raw forms", () => {
    tests.template_string_literals_decode_exact_interpreted_and_raw_forms();
  });
  runTest("template text compatibility functions are deterministic", () => {
    tests.template_text_compatibility_functions_are_deterministic();
  });
  runTest("template regular expression functions preserve matches, groups, and limits", () => {
    tests.template_regular_expression_functions_preserve_matches_groups_and_limits();
  });
  runTest("template scanning preserves Unicode scalars and UTF-16 locations", () => {
    tests.template_scanning_preserves_unicode_scalars_and_utf16_locations();
  });
  runTest("dictionary range order is deterministic", () => {
    tests.dictionary_range_order_is_deterministic();
  });
  runTest("parser reports exact malformed input diagnostics", () => {
    tests.parser_reports_exact_malformed_input_diagnostics();
  });
  runTest("shortcode parser rejects ambiguous input with exact locations", () => {
    tests.shortcode_parser_rejects_ambiguous_input_with_exact_locations();
  });
  runTest("evaluator reports exact unknown and invalid operations", () => {
    tests.evaluator_reports_exact_unknown_and_invalid_operations();
  });
  runTest("dictionary values are resolved without name fallbacks", () => {
    tests.dictionary_values_are_resolved_without_name_fallbacks();
  });
};
