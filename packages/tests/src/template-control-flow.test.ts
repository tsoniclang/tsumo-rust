import { parseTemplate } from "@tsumo/engine/testing.js";
import { Assert, runTest } from "./test-root.js";
import { captureDiagnosticCode, render } from "./template-test-harness.js";

export class TemplateControlFlowTests {
  range_break_and_continue_target_the_innermost_active_range(): void {
    Assert.StringEqual(
      "134",
      render(
        "{{ range seq 6 }}" +
        "{{ if eq . 2 }}{{ continue }}{{ end }}" +
        "{{ if eq . 5 }}{{ break }}{{ end }}" +
        "{{ . }}{{ end }}",
      ),
    );
    Assert.StringEqual(
      "1:1;2:1;",
      render(
        "{{ range $outer := seq 2 }}{{$outer}}:" +
        "{{ range seq 3 }}{{ if eq . 2 }}{{ break }}{{ end }}{{ . }}{{ end }};" +
        "{{ end }}",
      ),
    );
    Assert.StringEqual(
      "1",
      render("{{ range seq 3 }}{{ . }}{{ range (slice) }}x{{ else }}{{ break }}{{ end }}X{{ end }}"),
    );
  }

  parser_rejects_loop_control_without_an_active_range(): void {
    Assert.StringEqual(
      "TSUMO_TEMPLATE_BREAK_OUTSIDE_RANGE",
      captureDiagnosticCode(() => {
        parseTemplate("{{ break }}");
      }),
    );
    Assert.StringEqual(
      "TSUMO_TEMPLATE_CONTINUE_OUTSIDE_RANGE",
      captureDiagnosticCode(() => {
        parseTemplate("{{ continue }}");
      }),
    );
    Assert.StringEqual(
      "TSUMO_TEMPLATE_LOOP_CONTROL_INVALID",
      captureDiagnosticCode(() => {
        parseTemplate("{{ range seq 1 }}{{ break 1 }}{{ end }}");
      }),
    );
    Assert.StringEqual(
      "TSUMO_TEMPLATE_BREAK_OUTSIDE_RANGE",
      captureDiagnosticCode(() => {
        parseTemplate("{{ range seq 1 }}{{ define \"independent\" }}{{ break }}{{ end }}{{ end }}");
      }),
    );
  }
}

export const runTemplateControlFlowTests = (): void => {
  const tests = new TemplateControlFlowTests();
  runTest("range break and continue target the innermost active range", () => {
    tests.range_break_and_continue_target_the_innermost_active_range();
  });
  runTest("parser rejects loop control without an active range", () => {
    tests.parser_rejects_loop_control_without_an_active_range();
  });
};
