import type { InMemoryStore } from "@langchain/langgraph";
import type { AgentStateType, AgentUpdateType } from "../state.js";
import { conclusionsNamespace, globalConclusionsNamespace } from "../../memory/store.js";
import { v4 as uuidv4 } from "uuid";

export function createMemoryWriterNode(store: InMemoryStore) {
  return async (state: AgentStateType): Promise<Partial<AgentUpdateType>> => {
    if (!state.conclusion || !state.experimentKey) {
      return { phase: "done" };
    }

    const timestamp = new Date().toISOString();
    const itemId = uuidv4();

    const memoryItem = {
      conclusion: state.conclusion,
      statisticalResults: state.statisticalResults,
      phase: state.phase,
      timestamp,
      experimentKey: state.experimentKey,
    };

    // Store in experiment-specific namespace
    await store.put(
      conclusionsNamespace(state.experimentKey),
      itemId,
      memoryItem
    );

    // Also store in global conclusions namespace for cross-experiment search
    await store.put(
      globalConclusionsNamespace(),
      `${state.experimentKey}-${itemId}`,
      memoryItem
    );

    return { phase: "done" };
  };
}
