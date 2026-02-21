import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { AgentStateType, AgentUpdateType } from "../state.js";
import type { ConfigProposal } from "../state.js";

export function createToolExecutorNode(tools: StructuredToolInterface[]) {
  const toolNode = new ToolNode(tools);

  return async (state: AgentStateType): Promise<Partial<AgentUpdateType>> => {
    const result = await toolNode.invoke(state);

    // Check if the last AI message included a propose_config_change call
    const lastAiMessage = [...state.messages]
      .reverse()
      .find((m) => m instanceof AIMessage) as AIMessage | undefined;

    if (!lastAiMessage?.tool_calls?.length) {
      return result;
    }

    const proposalCall = lastAiMessage.tool_calls.find(
      (tc) => tc.name === "propose_config_change"
    );

    if (!proposalCall) {
      return result;
    }

    // Check if the tool returned { proposed: true }
    const toolMessages = result.messages ?? [];
    const proposalResponse = toolMessages.find(
      (m: any) => m.tool_call_id === proposalCall.id
    );

    if (!proposalResponse) {
      return result;
    }

    try {
      const parsed = JSON.parse(
        typeof proposalResponse.content === "string"
          ? proposalResponse.content
          : ""
      );
      if (parsed.proposed === true) {
        return {
          ...result,
          configProposal: proposalCall.args as ConfigProposal,
        };
      }
    } catch {
      // Not valid JSON or not a proposal — pass through
    }

    return result;
  };
}
