import { join, resolve } from "node:path";
import {
  normalizeResourceRelativePath,
  normalizeTemplateRelativePath,
  parseContent,
  parseJson,
  parseShortcodes,
  parseTemplate,
  resolveDocsOutputPath,
  SiteOutputPlan,
} from "@tsumo/engine/testing.js";
import { Assert, runTest } from "./test-root.js";
import { captureDiagnostic, captureDiagnosticCode, render } from "./template-test-harness.js";

export const runNativeTextTests = (): void => {
  runTest("native text slicing preserves scalars and combining marks", () => {
    Assert.StringEqual("😀é|é,😀,e,́,x|éx|x😀|value", render(
      '{{ substr "é😀éx" 1 3 }}|' +
      '{{ delimit (split "é😀éx" "") "," }}|' +
      '{{ strings.TrimLeft "😀" "😀éx" }}|' +
      '{{ strings.TrimRight "é" "x😀é" }}|' +
      '{{ strings.TrimSpace "\u00a0value\u3000" }}',
    ));
    Assert.StringEqual("ascii|", render('{{ substr "ascii" 0 5 }}|{{ substr "" 0 0 }}'));
  });

  runTest("native text casing and formatting never slice a partial scalar", () => {
    Assert.StringEqual("École 😀ab|École 😀|café-😀|é😀:value:中%|2024年😀", render(
      '{{ title "éCOLE 😀AB" }}|{{ humanize "école-😀" }}|' +
      '{{ anchorize "Café 😀" }}|{{ printf "é😀:%s:中%%" "value" }}|' +
      '{{ dateFormat "2006年😀" "2024-01-02T00:00:00Z" }}',
    ));
    Assert.StringEqual("&quot;é😀\\n中&quot;", render('{{ jsonify "é😀\\n中" }}'));
  });

  runTest("limited regex replacements preserve native offsets and Unicode replacement text", () => {
    Assert.StringEqual("ééx😀中x|éx😀$-x|éx😀x|é中x", render(
      '{{ replaceRE `(x)` `é$1😀` `éx中x` 1 }}|' +
      '{{ replaceRE `(?<word>x)` `é$<word>😀$$` `x-x` 1 }}|' +
      '{{ replaceRE `(?=x)` `é` `x😀x` 1 }}|' +
      '{{ replaceRE `😀` `中` `é😀x` 1 }}',
    ));
  });

  runTest("front matter readers retain Unicode values and array elements", () => {
    const sources = [
      '{"title":"Café 😀","tags":["é","中😀"]}\nBody é😀',
      '+++\ntitle = "Café 😀"\ntags = ["é", "中😀"]\n+++\nBody é😀',
      '---\ntitle: "Café 😀"\ntags: ["é", "中😀"]\n---\nBody é😀',
    ];
    for (const source of sources) {
      const parsed = parseContent(source, "content/é😀.md");
      Assert.StringEqual("Café 😀", parsed.frontMatter.title);
      Assert.StringArrayEqual(["é", "中😀"], parsed.frontMatter.tags);
      Assert.StringEqual("Body é😀", parsed.body);
    }
  });

  runTest("structured template readers keep quoted Unicode keys and multiline values", () => {
    Assert.StringEqual("😀,é|é😀|é 😀", render(
      '{{ $toml := transform.Unmarshal (dict "format" "toml") `"café" = { "clé" = ["😀", "é"] }` }}' +
      '{{ delimit (index (index $toml "café") "clé") "," }}|' +
      '{{ $yaml := transform.Unmarshal (dict "format" "yaml") `"café": "é😀"` }}' +
      '{{ index $yaml "café" }}|' +
      '{{ $lines := transform.Unmarshal (dict "format" "yaml") `key: \'é\n  😀\'` }}' +
      '{{ $lines.key }}',
    ));
  });

  runTest("shortcodes preserve Unicode parameters bodies and native source spans", () => {
    const source = "é😀 {{< figure caption='café 🚀' >}}";
    const calls = parseShortcodes(source, "content/é.md");
    Assert.NumberEqual(1, calls.length);
    Assert.StringEqual("café 🚀", calls[0]!.params.get("caption")?.stringValue);
    Assert.NumberEqual(5, calls[0]!.column);
    Assert.StringEqual("{{< figure caption='café 🚀' >}}", source.slice(calls[0]!.startIndex, calls[0]!.endIndex));
    const paired = parseShortcodes("😀 {{< note >}}中é{{< /note >}}");
    Assert.NumberEqual(1, paired.length);
    Assert.StringEqual("中é", paired[0]!.inner);
    const escaped = parseShortcodes('{{< figure caption="é\\😀" >}}');
    Assert.StringEqual("é😀", escaped[0]!.params.get("caption")?.stringValue);
    const fenced = parseShortcodes("```é\n{{< ignored >}}\n```\né{{< shown >}}");
    Assert.NumberEqual(1, fenced.length);
    Assert.StringEqual("shown", fenced[0]!.name);
    Assert.NumberEqual(2, fenced[0]!.column);
  });

  runTest("diagnostics retain explicit UTF-16 columns independently of native byte offsets", () => {
    const template = captureDiagnostic(() => { parseTemplate("é😀{{ if true", "layouts/é.html"); });
    Assert.StringEqual("TSUMO_TEMPLATE_ACTION_UNCLOSED", template.code);
    Assert.NumberEqual(4, template.column);
    const shortcode = captureDiagnostic(() => { parseShortcodes("é😀\r\n中́{{< missing", "content/é.md"); });
    Assert.StringEqual("TSUMO_SHORTCODE_ACTION_UNCLOSED", shortcode.code);
    Assert.NumberEqual(2, shortcode.line);
    Assert.NumberEqual(3, shortcode.column);
    const json = captureDiagnostic(() => { parseJson('{"é😀":}', "é.json"); });
    Assert.StringEqual("TSUMO_JSON_SYNTAX_INVALID", json.code);
    Assert.NumberEqual(8, json.column);
  });

  runTest("Unicode relative paths retain drive and containment rejection", () => {
    Assert.StringEqual("é/😀.txt", normalizeResourceRelativePath("é/😀.txt"));
    Assert.StringEqual("é/😀.html", normalizeTemplateRelativePath("é/😀.html"));
    const outputRoot = resolve(".temp/native-text-output");
    Assert.StringEqual(join(outputRoot, "é", "😀.html"), resolveDocsOutputPath(outputRoot, "é/😀.html"));
    const output = new SiteOutputPlan();
    output.addText("é/😀.html", "content", "unicode proof");
    Assert.NumberEqual(1, output.generatedOutputCount());
    Assert.StringEqual("TSUMO_RESOURCE_PATH_ABSOLUTE", captureDiagnosticCode(() => {
      normalizeResourceRelativePath("C:/é.txt");
    }));
    Assert.StringEqual("TSUMO_TEMPLATE_PATH_ABSOLUTE", captureDiagnosticCode(() => {
      normalizeTemplateRelativePath("C:/é.html");
    }));
    Assert.StringEqual("TSUMO_DOCS_OUTPUT_PATH_ESCAPES_ROOT", captureDiagnosticCode(() => {
      resolveDocsOutputPath(outputRoot, "../é.html");
    }));
    Assert.StringEqual("TSUMO_OUTPUT_PATH_ABSOLUTE", captureDiagnosticCode(() => {
      output.addText("C:/é.html", "content", "rejected proof");
    }));
  });

  runTest("Unicode query values retain exact percent-escape validation", () => {
    Assert.StringEqual("café😀|é", render(
      '{{ $url := urls.Parse "/page?q=café😀&encoded=%C3%A9" }}' +
      '{{ $url.Query.Get "q" }}|{{ $url.Query.Get "encoded" }}',
    ));
    Assert.StringEqual("TSUMO_TEMPLATE_URL_QUERY_INVALID", captureDiagnosticCode(() => {
      render('{{ $url := urls.Parse "/page?q=%é" }}{{ $url.Query.Get "q" }}');
    }));
  });
};
