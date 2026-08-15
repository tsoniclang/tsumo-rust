import { Assert, runTest } from "./test-root.js";
import { captureDiagnosticCode, render } from "./template-test-harness.js";

export class TemplateFunctionSemanticsTests {
  template_namespaces_expose_exact_string_and_hugo_functions(): void {
    Assert.StringEqual("=====", render("{{ strings.Repeat 5 \"=\" }}"));
    Assert.StringEqual("Hello World", render("{{ strings.Title \"hello world\" }}"));
    Assert.StringEqual("3|9|4|4|5", render(
      "{{ math.Min 9 3 7 }}|{{ math.Max 9 3 7 }}|{{ math.Round 4 }}|{{ math.Ceil 4 }}|{{ math.Add 2 3 }}",
    ));
    Assert.StringEqual("c,b,a|a,b", render(
      "{{ delimit (collections.Reverse (slice \"a\" \"b\" \"c\")) `,` }}|{{ delimit (strings.Split \"a,b\" `,`) `,` }}",
    ));
    Assert.StringEqual("string|bool|int|map[string]interface {}|&quot;quoted&quot;|true|3", render(
      "{{ printf \"%T|%T|%T|%T|%q|%t|%v\" \"value\" true 3 (dict \"key\" \"value\") \"quoted\" true 3 }}",
    ));
    Assert.StringEqual(
      '<meta name="generator" content="Hugo 0.146.2">',
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
    Assert.StringEqual("false|only|42", render("{{ default \"fallback\" false }}|{{ default \"only\" }}|{{ default 42 0 }}"));
    Assert.StringEqual("nil", render("{{ if nil }}value{{ else }}nil{{ end }}"));
    Assert.StringEqual("line", render("{{ chomp \"line\\n\" }}"));
    Assert.StringEqual("2024", render("{{ now.Year }}"));
    Assert.StringEqual("configured", render("{{ getenv \"TSUMO_TEST_VALUE\" }}"));
    Assert.StringEqual("", render("{{ getenv \"TSUMO_MISSING_VALUE\" }}"));
    Assert.StringEqual("true|false", render("{{ fileExists \"static/existing.css\" }}|{{ fileExists \"static/missing.css\" }}"));
    Assert.StringEqual("true", render("{{ collections.IsSet (dict \"key\" \"value\") \"key\" }}"));
    Assert.StringEqual("translated", render("{{ T \"translated\" }}"));
    Assert.StringEqual("2026|42", render("{{ int \"2026\" }}|{{ string 42 }}"));
    Assert.StringEqual("true|false", render("{{ collections.In (collections.Slice \"first\" \"second\") \"second\" }}|{{ collections.In (collections.Slice \"first\") \"second\" }}"));
    Assert.StringEqual("one two|first|one two|url.Values", render(
      "{{ $url := urls.Parse \"/page?classes=one+two&name=first&name=second\" }}" +
      "{{ $url.Query.Get \"classes\" }}|{{ $url.Query.Get \"name\" }}|{{ $url.Query.classes }}|{{ printf \"%T\" $url.Query }}",
    ));
    Assert.StringEqual("", render("{{ $url := urls.Parse \"/page?name=value\" }}{{ $url.Query.Get \"missing\" }}"));
    Assert.StringEqual("🙂", render("{{ $url := urls.Parse \"/page?name=%F0%9F%99%82\" }}{{ $url.Query.Get \"name\" }}"));
    Assert.StringEqual("TSUMO_TEMPLATE_URL_QUERY_INVALID", captureDiagnosticCode(() => {
      render("{{ $url := urls.Parse \"/page?name=%ZZ\" }}{{ $url.Query.Get \"name\" }}");
    }));
    Assert.StringEqual("TSUMO_TEMPLATE_URL_QUERY_INVALID", captureDiagnosticCode(() => {
      render("{{ $url := urls.Parse \"/page?name=%F0%28%8C%28\" }}{{ $url.Query.Get \"name\" }}");
    }));
    Assert.StringEqual("value|nested", render(
      "{{ hugo.Store.Set \"name\" \"value\" }}{{ hugo.Store.SetInMap \"items\" \"key\" \"nested\" }}" +
      "{{ hugo.Store.Get \"name\" }}|{{ index (hugo.Store.Get \"items\") \"key\" }}",
    ));
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
}

export const runTemplateFunctionSemanticsTests = (): void => {
  const tests = new TemplateFunctionSemanticsTests();
  runTest("template namespaces expose exact string and Hugo functions", () => {
    tests.template_namespaces_expose_exact_string_and_hugo_functions();
  });
};
