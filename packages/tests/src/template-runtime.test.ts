import {
  DictValue,
  PageContext,
  parseShortcodes,
  parseTemplate,
  RenderScope,
  SiteConfig,
  SiteContext,
  StringValue,
  Template,
  TemplateEnvironment,
  TemplateValue,
  TextBuilder,
  TsumoDiagnostic,
  TsumoError,
} from "@tsumo/engine/testing.js";
import { Assert, runTest } from "./test-root.js";

class TestTemplateEnvironment extends TemplateEnvironment {
  getTemplate(_path: string): Template | undefined {
    return undefined;
  }
}

const createSite = (): SiteContext => {
  const config = new SiteConfig("Test Site", "https://example.test/", "en", undefined, undefined);
  const pages: PageContext[] = [];
  return new SiteContext(config, pages, undefined, undefined);
};

const renderWithRoot = (source: string, root: TemplateValue): string => {
  const template = parseTemplate(source);
  const environment = new TestTemplateEnvironment();
  const site = createSite();
  const scope = new RenderScope(root, root, site, environment, undefined);
  const output = new TextBuilder();
  template.renderInto(output, scope, environment, new Map());
  return output.toString();
};

const render = (source: string): string =>
  renderWithRoot(source, new DictValue(new Map<string, TemplateValue>()));

const captureDiagnosticCode = (operation: () => void): string => {
  try {
    operation();
  } catch (error) {
    if (error instanceof TsumoError) return error.diagnostic.code;
    throw error;
  }
  throw new Error("Expected a TsumoError diagnostic");
};

const captureDiagnostic = (operation: () => void): TsumoDiagnostic => {
  try {
    operation();
  } catch (error) {
    if (error instanceof TsumoError) return error.diagnostic;
    throw error;
  }
  throw new Error("Expected a TsumoError diagnostic");
};

export class TemplateRuntimeTests {
  parser_and_evaluator_render_control_flow_and_pipeline(): void {
    const source = "{{ if true }}yes{{ else }}no{{ end }}|{{ \"ab\" | upper }}";
    Assert.StringEqual("yes|AB", render(source));
  }

  collection_functions_preserve_exact_split_segments(): void {
    Assert.StringEqual("a|b|", render("{{ delimit (split \"a--b--\" \"--\") \"|\" }}"));
    Assert.StringEqual("a|b", render("{{ delimit (split \"ab\" \"\") \"|\" }}"));
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
