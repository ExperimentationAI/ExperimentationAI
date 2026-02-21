import { ToolMessage } from "@langchain/core/messages";
import type { MessageBus } from "../../io/message-bus.js";
import type { AnalysisResult } from "../../io/types.js";
import type { AgentStateType, AgentUpdateType } from "../state.js";

export function createPublishResultNode(bus: MessageBus) {
  return async (state: AgentStateType): Promise<Partial<AgentUpdateType>> => {
    if (!state.conclusion || !state.experimentKey) {
      return {};
    }

    // Extract dashboardPath from render_dashboard tool message
    let dashboardPath: string | undefined;
    for (const msg of state.messages) {
      if (
        msg instanceof ToolMessage &&
        msg.name === "render_dashboard" &&
        typeof msg.content === "string"
      ) {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed.dashboardPath) {
            dashboardPath = parsed.dashboardPath;
          }
        } catch {
          // ignore parse errors
        }
      }
    }

    const result: AnalysisResult = {
      type: "experiment_analysis",
      experimentKey: state.experimentKey,
      correlationId: state.correlationId ?? "",
      conclusion: state.conclusion,
      recommendation: extractRecommendation(state.conclusion),
      statisticalResults: state.statisticalResults,
      phase: state.phase,
      replyTo: state.replyTo ?? undefined,
      dashboardPath,
      timestamp: new Date().toISOString(),
    };

    await bus.publish(result);

    return {};
  };
}

function extractRecommendation(conclusion: string): string {
  // Try to extract a recommendation section from the conclusion
  const recMatch = conclusion.match(
    /(?:recommend(?:ation)?|suggest(?:ion)?|next steps?)[:\s]*(.+?)(?:\n\n|$)/is
  );
  if (recMatch) {
    return recMatch[1].trim();
  }
  // Fallback: use the last paragraph
  const paragraphs = conclusion.split("\n\n").filter((p) => p.trim());
  return paragraphs[paragraphs.length - 1]?.trim() ?? conclusion;
}
