import { ChatAnthropic } from "@langchain/anthropic";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { AgentStateType, AgentUpdateType } from "../state.js";

export function createReasoningNode(
  tools: StructuredToolInterface[],
  options?: { modelName?: string }
) {
  const model = new ChatAnthropic({
    model: options?.modelName ?? "claude-sonnet-4-5-20250929",
    temperature: 0,
  }).bindTools(tools);

  return async (state: AgentStateType): Promise<Partial<AgentUpdateType>> => {
    const systemParts: string[] = [
      "You are an expert experiment analyst. Your job is to analyze A/B tests rigorously using statistical methods.",
      "",
      "## Your workflow:",
      "1. First, use `get_experiment` to understand the experiment setup (variants, metrics, status)",
      "2. Use `get_experiment_metrics` to fetch metric data for all relevant metrics",
      "3. For each metric, run the appropriate statistical test:",
      "   - For continuous metrics (revenue, duration): use `run_t_test`",
      "   - For binary metrics (conversion, click-through): use `run_z_test`",
      "4. Synthesize findings into a clear conclusion and recommendation",
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

    return { messages: [response] };
  };
}
