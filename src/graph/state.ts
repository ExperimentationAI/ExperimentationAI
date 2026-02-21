import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
import type { ExperimentMetricData } from "../interfaces/data-source.js";
import type { StatisticalTestResult } from "../stats/types.js";
import type { ReplyTo } from "../io/types.js";
import type { ExperimentStatus } from "../interfaces/experiment-platform.js";

export type ConfigProposal =
  | { action: "set_status"; experimentKey: string; status: ExperimentStatus; reason: string }
  | { action: "update_weights"; experimentKey: string; weights: Array<{ variantKey: string; weight: number }>; reason: string }
  | { action: "update_feature_flag"; featureKey: string; enabled: boolean; rules?: Record<string, unknown>[]; reason: string };

export interface ConfigChangeResult {
  approved: boolean;
  action: string;
  error?: string;
  timestamp: string;
}

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

  configProposal: Annotation<ConfigProposal | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  configChangeResult: Annotation<ConfigChangeResult | null>({
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
