import type { InMemoryStore } from "@langchain/langgraph";
import type { AgentStateType, AgentUpdateType } from "../state.js";
import { conclusionsNamespace } from "../../memory/store.js";

export function createLoadContextNode(store: InMemoryStore) {
  return async (state: AgentStateType): Promise<Partial<AgentUpdateType>> => {
    const experimentKey = state.experimentKey;
    if (!experimentKey) {
      return {
        phase: "gathering",
        priorConclusions: [],
      };
    }

    const namespace = conclusionsNamespace(experimentKey);
    const items = await store.search(namespace, { limit: 20 });

    const priorConclusions = items.map((item) => {
      const val = item.value as Record<string, unknown>;
      return `[${item.updatedAt ?? item.createdAt}] ${val.conclusion ?? JSON.stringify(val)}`;
    });

    return {
      phase: "gathering",
      priorConclusions,
    };
  };
}
