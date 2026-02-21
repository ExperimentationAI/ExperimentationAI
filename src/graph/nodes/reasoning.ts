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
      "## Guidelines:",
      "- Always check sample sizes before running tests",
      "- Report effect sizes and confidence intervals, not just p-values",
      "- Consider practical significance, not just statistical significance",
      "- If results are inconclusive, say so and recommend what to do next",
      "- Compare findings with prior conclusions if available",
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
