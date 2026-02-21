import { ChatAnthropic } from "@langchain/anthropic";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import type { AgentStateType, AgentUpdateType } from "../state.js";

export function createReasoningNode(
  tools: StructuredToolInterface[],
  options?: { modelName?: string }
) {
  const model = new ChatAnthropic({
    model: options?.modelName ?? "claude-sonnet-4-6",
    temperature: 0,
  }).bindTools(tools);

  return async (state: AgentStateType): Promise<Partial<AgentUpdateType>> => {
    const systemParts: string[] = [
      "You are an expert experiment analyst. Your job is to analyze A/B tests rigorously using statistical methods.",
      "",
      "## Your workflow:",
      "1. Use `list_metrics` to discover available metrics in the data source",
      "2. Use `get_experiment_metrics` to fetch metric data for the experiment",
      "3. Optionally, try `get_experiment` to get platform metadata (variants, status, tags) — if it fails, continue with data-source metrics alone",
      "4. For each metric, run the appropriate statistical test:",
      "   - For continuous metrics (revenue, duration): use `run_t_test`",
      "   - For binary metrics (conversion, click-through): use `run_z_test`",
      "5. Synthesize findings into a clear conclusion and recommendation",
      "",
      "## Non-inferiority testing workflow:",
      "For experiments where shorter/cheaper/simpler treatments win by default (e.g., trial length optimization),",
      "use non-inferiority testing instead of standard two-sided tests:",
      "",
      "1. **Check maturity first** — use `check_maturity` before any analysis.",
      "   Different trial lengths create unequal observation windows. A 3-day trial user",
      "   has more paid days in a 30-day window than a 14-day trial user.",
      "   If maturity is insufficient, warn the stakeholder and note caveats.",
      "",
      "2. **Run non-inferiority tests** — use `run_non_inferiority_test` for the primary metric.",
      "   The question is NOT 'is treatment different?' but 'is treatment not meaningfully worse?'",
      "   Use α=0.10 (one-sided) for non-inferiority. A 10% relative margin is standard.",
      "",
      "3. **Multi-arm comparison** — use `run_multi_arm_analysis` when there are 3+ variants.",
      "   This handles pairwise non-inferiority tests with Holm-Bonferroni correction.",
      "   It will recommend the best passing variant.",
      "",
      "4. **Check guardrails** — use `check_guardrails` for hard constraints.",
      "   Examples: retention must not drop >5% relative, refunds must not increase >1pp.",
      "   Report PASS/FAIL/INCONCLUSIVE with power estimates.",
      "",
      "5. **Analyze the funnel** — use `analyze_funnel` to see stage-by-stage conversion.",
      "   Identify which stage(s) drive the overall difference.",
      "",
      "6. **Check power** — use `calculate_power` to verify sample size adequacy.",
      "   If underpowered, say so explicitly and recommend how much longer to run.",
      "",
      "7. **Decompose if needed** — use `decompose_metric` to separate rate vs mix effects.",
      "   If LTV differs, is it because conversion rates changed or because different users converted?",
      "",
      "## Guidelines:",
      "- Always check sample sizes before running tests",
      "- Report effect sizes and confidence intervals, not just p-values",
      "- Consider practical significance, not just statistical significance",
      "- If results are inconclusive, say so and recommend what to do next",
      "- Compare findings with prior conclusions if available",
      "- For non-inferiority: passing means the treatment is NOT meaningfully worse,",
      "  which combined with business benefits (faster cash velocity) makes it a winner",
      "",
      "## Synthesis & Decision Framework:",
      "",
      "When you've gathered all the evidence, reason toward one of three verdicts:",
      "",
      "**Ship it** — Primary metric is non-inferior (or superior), all guardrails pass.",
      "The variant delivers business value and nothing blocks it. Say so clearly and confidently.",
      "",
      "**Keep running** — Results are inconclusive. Either the test is underpowered, the data",
      "is immature, or guardrails can't be evaluated yet. Specify what's needed to reach a decision",
      "(more time, more volume, a specific metric maturing).",
      "",
      "**Kill it** — You're confident the variant hurts a metric that matters. Either the primary",
      "metric fails with adequate power, or a guardrail is violated. Recommend shutting it down.",
      "",
      "### Reasoning principles:",
      "- Guardrails are hard constraints — a guardrail violation vetoes a ship decision, period.",
      "- Underpowered ≠ no effect. If the test is inconclusive but lacks power, that's 'not enough",
      "  data,' not 'no difference.' Never confuse the two.",
      "- For non-inferiority experiments, the default action is *better* (shorter trial = faster cash).",
      "  The bar is 'does it NOT hurt?' not 'does it help?' Frame conclusions accordingly.",
      "- When multiple variants pass, think about business value, not just statistical ranking.",
      "  A shorter trial that passes NI is better than a longer trial with slightly higher LTV.",
      "- Diagnostics (funnel, decomposition) explain the *why* behind the numbers.",
      "  Use them to build the narrative, not to override the statistical decision.",
      "",
      "### Cross-metric conflict resolution:",
      "- Primary passes + guardrail fails → **Kill**. Guardrails aren't negotiable.",
      "- Primary passes + guardrail inconclusive → **Keep running**. You can't ship what you can't clear.",
      "- Primary fails + underpowered → **Keep running**. Absence of evidence ≠ evidence of absence.",
      "- Everything passes → **Ship**. Say so clearly and confidently.",
      "",
      "## Dashboard rendering:",
      "After completing all statistical analyses and forming your verdict,",
      "call `render_dashboard` with structured data from your analysis.",
      "Pass the data you already have from tool results — no new computation needed.",
      "Call render_dashboard BEFORE writing your final text conclusion.",
      "",
      "### In your conclusion, address (in whatever order feels natural):",
      "- Is the experiment ready to read? (maturity, power)",
      "- What happened to the primary metric? Is the effect real?",
      "- Are the guardrails clean?",
      "- Where in the funnel did the differences show up?",
      "- What's the business implication?",
      "- What should we do next — and why?",
    ];

    if (state.priorConclusions.length > 0) {
      systemParts.push(
        "",
        "## Prior conclusions for this experiment:",
        ...state.priorConclusions.map((c) => `- ${c}`)
      );
    }

    if (state.userContext) {
      systemParts.push(
        "",
        "## User-provided context:",
        state.userContext
      );
    }

    const systemMessage = new SystemMessage(systemParts.join("\n"));

    const messages = [
      systemMessage,
      ...state.messages,
    ];

    if (state.messages.length === 0) {
      messages.push(
        new HumanMessage(
          `Analyze the experiment "${state.experimentKey}". ` +
            `Fetch the experiment details, gather metrics data, run statistical tests, ` +
            `and provide a clear conclusion with a recommendation.`
        )
      );
    }

    const response = await model.invoke(messages);

    // When the model produces a final text response (no tool calls),
    // extract it as the conclusion so downstream nodes can publish it.
    const update: Partial<AgentUpdateType> = { messages: [response] };
    if (
      response instanceof AIMessage &&
      (!response.tool_calls || response.tool_calls.length === 0) &&
      response.content
    ) {
      const text =
        typeof response.content === "string"
          ? response.content
          : response.content
              .filter((b): b is { type: "text"; text: string } => (b as any).type === "text")
              .map((b) => b.text)
              .join("\n");
      if (text) {
        update.conclusion = text;
        update.phase = "concluding";
      }
    }

    return update;
  };
}
