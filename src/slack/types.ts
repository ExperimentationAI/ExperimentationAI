import { z } from "zod";

// --- Intent types ---

const AnalyzeIntent = z.object({
  type: z.literal("analyze"),
  experimentKey: z.string(),
  userContext: z.string().optional(),
});

const MonitorIntent = z.object({
  type: z.literal("monitor"),
  experimentKey: z.string(),
  cronExpression: z.string(),
  userContext: z.string().optional(),
});

const StopIntent = z.object({
  type: z.literal("stop"),
  experimentKey: z.string(),
});

const StatusIntent = z.object({
  type: z.literal("status"),
});

const HelpIntent = z.object({
  type: z.literal("help"),
});

const UnknownIntent = z.object({
  type: z.literal("unknown"),
  rawText: z.string(),
});

export const SlackIntentSchema = z.discriminatedUnion("type", [
  AnalyzeIntent,
  MonitorIntent,
  StopIntent,
  StatusIntent,
  HelpIntent,
  UnknownIntent,
]);

export type SlackIntent = z.infer<typeof SlackIntentSchema>;

// --- Slack-specific ReplyTo ---

export interface SlackReplyTo {
  channel: "slack";
  destination: string; // Slack channel ID
  threadId: string; // thread_ts
}
