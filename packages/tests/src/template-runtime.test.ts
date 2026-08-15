import { join } from "node:path";

import {
  DictValue,
  DateValue,
  PageContext,
  PageValue,
  parseShortcodes,
  parseTemplate,
  RenderScope,
  ResourceManager,
  StringValue,
  TemplateValue,
  TextBuilder,
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
  }

  collection_functions_preserve_exact_split_segments(): void {
    Assert.StringEqual("a|b|", render("{{ delimit (split \"a--b--\" \"--\") \"|\" }}"));
    Assert.StringEqual("a|b", render("{{ delimit (split \"ab\" \"\") \"|\" }}"));
  }

  template_namespaces_expose_exact_string_and_hugo_functions(): void {
    Assert.StringEqual("=====", render("{{ strings.Repeat 5 \"=\" }}"));
    Assert.StringEqual(
      '<meta name="generator" content="Hugo 0.146.0">',
      render("{{ hugo.Generator }}"),
    );
    Assert.StringEqual(
      "TSUMO_TEMPLATE_STRING_REPEAT_INVALID",
      captureDiagnosticCode(() => {
        render("{{ strings.Repeat -1 \"=\" }}");
      }),
    );
    Assert.StringEqual("a,b", render("{{ delimit (collections.First 2 (collections.Slice \"a\" \"b\" \"c\")) \",\" }}"));
    Assert.StringEqual("fallback", render("{{ compare.Default \"fallback\" \"\" }}"));
    Assert.StringEqual("line", render("{{ chomp \"line\\n\" }}"));
    Assert.StringEqual("2024", render("{{ now.Year }}"));
    Assert.StringEqual("configured", render("{{ getenv \"TSUMO_TEST_VALUE\" }}"));
    Assert.StringEqual("", render("{{ getenv \"TSUMO_MISSING_VALUE\" }}"));
    Assert.StringEqual("true", render("{{ collections.IsSet (dict \"key\" \"value\") \"key\" }}"));
    Assert.StringEqual("true|false", render("{{ collections.In (collections.Slice \"first\" \"second\") \"second\" }}|{{ collections.In (collections.Slice \"first\") \"second\" }}"));
    Assert.StringEqual("first,second", render("{{ delimit (transform.Unmarshal \"- first\\n- second\") \",\" }}"));
    Assert.StringEqual("value", render("{{ (transform.Unmarshal \"{\\\"key\\\":\\\"value\\\"}\").key }}"));
    Assert.StringEqual("_partials/site-style.html", render("{{ fmt.Print \"_partials/\" \"site-style.html\" }}"));
    Assert.StringEqual("true", render("{{ hasPrefix \"<svg viewBox=0>\" \"<svg\" }}"));
    Assert.StringEqual("true|true|false", render(
      "{{ reflect.IsMap (dict \"key\" \"value\") }}|{{ reflect.IsSlice (slice \"value\") }}|{{ reflect.IsMap (slice) }}",
    ));
    Assert.StringEqual("value|true|trimmed", render(
      "{{ strings.ToLower \"VALUE\" }}|{{ strings.HasSuffix \"index.html\" \".html\" }}|{{ strings.Trim \"/trimmed/\" \"/\" }}",
    ));
    Assert.StringEqual(
      "a%20b=c%2Fd|.css|content/page.md|900150983cd24fb0d6963f7d28e17f72|Hello World|3",
      render(
        "{{ collections.Querify \"a b\" \"c/d\" }}|{{ path.Ext \"assets/main.css\" }}|" +
        "{{ path.Join \"content\" \"posts\" \"..\" \"page.md\" }}|{{ crypto.MD5 \"abc\" }}|" +
        "{{ inflect.Humanize \"hello-world\" }}|{{ math.Ceil 3 }}",
      ),
    );
    Assert.StringEqual(
      "/asset.css|https://example.test/asset.css|https://example.test/asset.css|&lt;x&gt;",
      render(
        "{{ urls.RelURL \"asset.css\" }}|{{ urls.AbsURL \"/asset.css\" }}|" +
        "{{ urls.AbsLangURL \"/asset.css\" }}|{{ safeHTML (transform.HTMLEscape \"<x>\") }}",
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

  date_page_data_and_render_methods_use_typed_context(): void {
    Assert.StringEqual("2024-01-02", renderWithRoot("{{ .Format \"2006-01-02\" }}", new DateValue("2024-01-02T03:04:05Z")));

    const site = createSite();
    const older = createPage(site, "Older", "2022-04-01T00:00:00Z", "page");
    const newer = createPage(site, "Newer", "2024-06-01T00:00:00Z", "page");
    const root = createPage(site, "Home", "", "home");
    root.pages = [older, newer];
    const section = createPage(site, "Section", "", "section");
    root.pages.push(section);
    Assert.StringEqual(
      "2024:Newer;2022:Older;",
      renderWithRoot("{{ range .Data.Pages.GroupByDate \"2006\" }}{{ .Key }}:{{ range .Pages }}{{ .Title }}{{ end }};{{ end }}", new PageValue(root)),
    );
    Assert.StringEqual("3", renderWithRoot("{{ len (union .RegularPages .Sections) }}", new PageValue(root)));

    const environment = new TestTemplateEnvironment();
    environment.templates.set("_partials/templates/_funcs/child", parseTemplate("child={{ . }}", "_partials/templates/_funcs/child.html"));
    const parent = parseTemplate("{{ partial \"_funcs/child\" \"exact\" }}", "_partials/templates/parent.html");
    const parentScope = new RenderScope(new PageValue(root), new PageValue(root), site, environment, undefined, undefined, parent.sourcePath);
    const output = new TextBuilder();
    parent.renderInto(output, parentScope, environment, new Map());
    Assert.StringEqual("child=exact", output.toString());

    const pageTemplate = parseTemplate("{{ .Render \"summary\" }}");
    const pageOutput = new TextBuilder();
    const pageScope = new RenderScope(new PageValue(newer), new PageValue(newer), site, environment, undefined);
    pageTemplate.renderInto(pageOutput, pageScope, environment, new Map());
    Assert.StringEqual("<summary>Newer</summary>", pageOutput.toString());
  }

  page_taxonomy_terms_follow_explicit_graph_relations(): void {
    const site = createSite();
    const page = createPage(site, "Article", "2024-01-01T00:00:00Z", "page");
    const term = createPage(site, "TypeScript", "", "term");
    const memberships = new Map<string, PageContext[]>();
    memberships.set("typescript", [page]);
    site.Taxonomies.set("tags", memberships);
    const termPages = new Map<string, PageContext>();
    termPages.set("typescript", term);
    site.taxonomyTermPages.set("tags", termPages);

    Assert.StringEqual(
      "TypeScript;",
      renderWithRoot("{{ range .GetTerms \"tags\" }}{{ .Title }};{{ end }}", new PageValue(page)),
    );
  }

  template_definitions_propagate_across_partial_boundaries(): void {
    const site = createSite();
    const root = createPage(site, "Home", "", "home");
    const environment = new TestTemplateEnvironment();
    environment.templates.set(
      "partials/child",
      parseTemplate("{{ template \"integrity\" . }}", "partials/child"),
    );

    const parent = parseTemplate(
      "{{ define \"integrity\" }}integrity={{ . }}{{ end }}{{ partial \"child\" \"external\" }}",
      "partials/parent",
    );
    Assert.StringEqual(
      "integrity=external",
      environment.renderTemplate(parent, new PageValue(root), site, new Map()),
    );

    const inline = parseTemplate(
      "{{ define \"_partials/inline\" }}inline={{ . }}{{ end }}{{ partials.IncludeCached \"inline\" \"local\" }}",
      "partials/inline-owner",
    );
    Assert.StringEqual(
      "inline=local",
      environment.renderTemplate(inline, new PageValue(root), site, new Map()),
    );

    environment.templates.set(
      "partials/page-global",
      parseTemplate(
        "{{ page.Title }}|{{ page.Store.Add \"visits\" 1 }}{{ page.Store.Get \"visits\" }}",
        "partials/page-global",
      ),
    );
    const contextual = parseTemplate("{{ partial \"page-global\" (dict \"context\" \"changed\") }}");
    Assert.StringEqual(
      "Home|1",
      environment.renderTemplate(contextual, new PageValue(root), site, new Map()),
    );
  }

  page_resources_use_the_published_bundle_inventory(): void {
    const root = createTestDirectory("template-page-resources");
    const siteDirectory = join(root, "site");
    const bundleDirectory = join(siteDirectory, "content", "article");
    const outputDirectory = join(root, "output");
    try {
      createDirectory(bundleDirectory);
      writeTextFile(join(bundleDirectory, "cover.svg"), "<svg></svg>");
      writeTextFile(join(bundleDirectory, "notes.txt"), "notes");

      const manager = new ResourceManager(siteDirectory, undefined, outputDirectory);
      const environment = new TestTemplateEnvironment(manager);
      const site = createSite();
      const page = createPage(site, "Article", "", "page");
      page.relPermalink = "/article/";
      page.resourceSourceDir = bundleDirectory;
      const template = parseTemplate(
        "{{ $images := .Resources.ByType \"image\" }}" +
        "{{ with ($images.GetMatch \"*.svg\") }}{{ .RelPermalink }}{{ end }}|" +
        "{{ with ($images.GetMatch \"{*cover*,*thumbnail*}\") }}{{ .RelPermalink }}{{ end }}|" +
        "{{ with .Resources.Get \"notes.txt\" }}{{ .RelPermalink }}{{ end }}",
      );

      Assert.StringEqual(
        "/article/cover.svg|/article/cover.svg|/article/notes.txt",
        environment.renderTemplate(template, new PageValue(page), site, new Map()),
      );
    } finally {
      deleteTestDirectory(root);
    }
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
  runTest("template namespaces expose exact string and Hugo functions", () => {
    tests.template_namespaces_expose_exact_string_and_hugo_functions();
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
  runTest("deferred templates finalize after normal render and share keyed results", () => {
    tests.deferred_templates_finalize_after_normal_render_and_share_keyed_results();
  });
  runTest("deferred templates distinguish authored occurrences with the same key", () => {
    tests.deferred_templates_distinguish_authored_occurrences_with_the_same_key();
  });
  runTest("template string literals decode exact interpreted and raw forms", () => {
    tests.template_string_literals_decode_exact_interpreted_and_raw_forms();
  });
  runTest("date, page data, and render methods use typed context", () => {
    tests.date_page_data_and_render_methods_use_typed_context();
  });
  runTest("page taxonomy terms follow explicit graph relations", () => {
    tests.page_taxonomy_terms_follow_explicit_graph_relations();
  });
  runTest("template definitions propagate across partial boundaries", () => {
    tests.template_definitions_propagate_across_partial_boundaries();
  });
  runTest("page resources use the published bundle inventory", () => {
    tests.page_resources_use_the_published_bundle_inventory();
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
