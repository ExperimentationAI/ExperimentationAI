import { END, START, StateGraph } from "@langchain/langgraph";
import type { BaseStore } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { AIMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { ExperimentPlatform } from "../interfaces/experiment-platform.js";
import type { DataSource } from "../interfaces/data-source.js";
import type { MessageBus } from "../io/message-bus.js";
import {
  createExperimentTools,
  createDataSourceTools,
  createStatsTools,
  createMemoryTools,
} from "../tools/index.js";
import { AgentState, type AgentStateType } from "./state.js";
import { createLoadContextNode } from "./nodes/load-context.js";
import { createReasoningNode } from "./nodes/reasoning.js";
import { createMemoryWriterNode } from "./nodes/memory-writer.js";
import { createPublishResultNode } from "./nodes/publish-result.js";

export interface CreateGraphOptions {
  platform: ExperimentPlatform;
  dataSource: DataSource;
  bus: MessageBus;
  store: BaseStore;
  checkpointPath?: string;
  modelName?: string;
}

export function createGraph(options: CreateGraphOptions) {
  const { platform, dataSource, bus, store } = options;

  // Create all tools
  const experimentTools = createExperimentTools(platform);
  const dataSourceTools = createDataSourceTools(dataSource);
  const statsTools = createStatsTools();
  const memoryTools = createMemoryTools(store);
  const allTools: StructuredToolInterface[] = [
    ...experimentTools,
    ...dataSourceTools,
    ...statsTools,
    ...memoryTools,
  ] as StructuredToolInterface[];

  // Create nodes
  const loadContext = createLoadContextNode(store);
  const reasoning = createReasoningNode(allTools, {
    modelName: options.modelName,
  });
  const toolNode = new ToolNode(allTools);
  const memoryWriter = createMemoryWriterNode(store);
  const publishResult = createPublishResultNode(bus);

  // Route after reasoning: tools if tool calls, conclude if done
  function routeAfterReasoning(state: AgentStateType) {
    const lastMessage = state.messages[state.messages.length - 1];

    if (
      lastMessage instanceof AIMessage &&
      lastMessage.tool_calls &&
      lastMessage.tool_calls.length > 0
    ) {
      return "tools";
    }

    // Extract conclusion from the last AI message content
    if (lastMessage instanceof AIMessage && lastMessage.content) {
      return "memory_writer";
    }

    return END;
  }

  // Build the graph
  const graph = new StateGraph(AgentState)
    .addNode("load_context", loadContext)
    .addNode("reasoning", reasoning)
    .addNode("tools", toolNode)
    .addNode("memory_writer", memoryWriter)
    .addNode("publish_result", publishResult)
    .addEdge(START, "load_context")
    .addEdge("load_context", "reasoning")
    .addConditionalEdges("reasoning", routeAfterReasoning, [
      "tools",
      "memory_writer",
      END,
    ])
    .addEdge("tools", "reasoning")
    .addEdge("memory_writer", "publish_result")
    .addEdge("publish_result", END);

  // Compile with checkpointer and store
  const checkpointer = SqliteSaver.fromConnString(
    options.checkpointPath ?? ":memory:"
  );

  return graph.compile({ checkpointer, store });
}
