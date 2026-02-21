import { z } from "zod";
import type { StatisticalTestResult } from "../stats/types.js";

export const ReplyToSchema = z.object({
  channel: z.string(),
  destination: z.string(),
  threadId: z.string().optional(),
});

export const MonitorRequestSchema = z.object({
  type: z.literal("monitor_experiment"),
  experimentKey: z.string(),
  userContext: z.string().optional(),
  replyTo: ReplyToSchema.optional(),
  requestedBy: z.string().optional(),
  correlationId: z.string(),
});

export type MonitorRequest = z.infer<typeof MonitorRequestSchema>;
export type ReplyTo = z.infer<typeof ReplyToSchema>;

export interface AnalysisResult {
  type: "experiment_analysis";
  experimentKey: string;
  correlationId: string;
  conclusion: string;
  recommendation: string;
  statisticalResults: StatisticalTestResult[];
  phase: string;
  replyTo?: ReplyTo;
  dashboardPath?: string;
  timestamp: string;
}
