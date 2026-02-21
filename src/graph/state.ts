import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
import type { ExperimentMetricData } from "../interfaces/data-source.js";
import type { StatisticalTestResult } from "../stats/types.js";
import type { ReplyTo } from "../io/types.js";

export const AgentState = Annotation.Root({
  // Inherit messages from MessagesAnnotation
  ...MessagesAnnotation.spec,

  experimentKey: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  phase: Annotation<
    "idle" | "gathering" | "analyzing" | "concluding" | "done"
  >({
    reducer: (_prev, next) => next,
    default: () => "idle",
  }),

  metricResults: Annotation<ExperimentMetricData[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),

  statisticalResults: Annotation<StatisticalTestResult[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),

  conclusion: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  priorConclusions: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  userContext: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  correlationId: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  replyTo: Annotation<ReplyTo | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  errors: Annotation<string[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
});

export type AgentStateType = typeof AgentState.State;
export type AgentUpdateType = typeof AgentState.Update;
