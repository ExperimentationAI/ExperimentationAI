import type { App } from "@slack/bolt";
import type { CompiledStateGraph } from "@langchain/langgraph";
import type { Scheduler, WatchedExperiment } from "../scheduler/scheduler.js";
import type { SlackReplyTo } from "./types.js";
import { parseIntent } from "./intent-parser.js";
import {
  formatAnalysisResult,
  formatMonitorConfirmation,
  formatStopConfirmation,
  formatStatusList,
  formatHelpMessage,
  formatErrorMessage,
} from "./formatter.js";
import { ProgressTracker } from "./progress-tracker.js";
import { v4 as uuidv4 } from "uuid";

export interface SlackBotOptions {
  app: App;
  graph: CompiledStateGraph<any, any, any>;
  scheduler: Scheduler;
  modelName?: string;
}

export class SlackBot {
  private app: App;
  private graph: CompiledStateGraph<any, any, any>;
  private scheduler: Scheduler;
  private modelName?: string;

  constructor(options: SlackBotOptions) {
    this.app = options.app;
    this.graph = options.graph;
    this.scheduler = options.scheduler;
    this.modelName = options.modelName;

    this.registerListeners();
  }

  private registerListeners(): void {
    // Handle @mentions in channels
    this.app.event("app_mention", async ({ event, say }) => {
      await this.handleMessage(event.text, event.channel, event.ts, say);
    });

    // Handle direct messages
    this.app.event("message", async ({ event, say }) => {
      // Only handle direct messages (no subtype = normal message)
      if ("subtype" in event && event.subtype) return;
      if (!("text" in event) || !event.text) return;
      // Only handle DMs (channel type "im")
      if (!("channel_type" in event) || event.channel_type !== "im") return;

      await this.handleMessage(event.text, event.channel, event.ts, say);
    });
  }

  private async handleMessage(
    text: string,
    channel: string,
    threadTs: string,
    say: (args: any) => Promise<any>
  ): Promise<void> {
    try {
      const intent = await parseIntent(text, {
        modelName: this.modelName,
      });

      switch (intent.type) {
        case "analyze":
          await this.handleAnalyze(
            intent.experimentKey,
            channel,
            threadTs,
            say,
            intent.userContext
          );
          break;
        case "monitor":
          await this.handleMonitor(
            intent.experimentKey,
            intent.cronExpression,
            channel,
            threadTs,
            say,
            intent.userContext
          );
          break;
        case "stop":
          await this.handleStop(intent.experimentKey, channel, threadTs, say);
          break;
        case "status":
          await this.handleStatus(channel, threadTs, say);
          break;
        case "help":
          await this.handleHelp(channel, threadTs, say);
          break;
        case "unknown":
          // Try to treat as an analyze request for the raw text
          await say({
            channel,
            thread_ts: threadTs,
            text: `I didn't understand that. Try \`help\` to see available commands, or \`analyze <experiment-key>\` to analyze a specific experiment.`,
          });
          break;
      }
    } catch (err) {
      console.error("SlackBot error:", err);
      await say({
        channel,
        thread_ts: threadTs,
        blocks: formatErrorMessage(err),
        text: "Something went wrong.",
      });
    }
  }

  private async handleAnalyze(
    experimentKey: string,
    channel: string,
    threadTs: string,
    say: (args: any) => Promise<any>,
    userContext?: string
  ): Promise<void> {
    // Ack immediately
    await say({
      channel,
      thread_ts: threadTs,
      text: `:hourglass_flowing_sand: Analyzing *${experimentKey}*...`,
    });

    const replyTo: SlackReplyTo = {
      channel: "slack",
      destination: channel,
      threadId: threadTs,
    };

    const tracker = new ProgressTracker({
      app: this.app,
      channel,
      threadTs,
      experimentKey,
    });

    try {
      const stream = await this.graph.stream(
        {
          experimentKey,
          userContext: userContext ?? null,
          correlationId: uuidv4(),
          replyTo,
        },
        {
          streamMode: "updates",
          recursionLimit: 100,
          configurable: { thread_id: `experiment-${experimentKey}` },
        }
      );

      for await (const chunk of stream) {
        const nodeName = Object.keys(chunk)[0];
        if (nodeName) {
          await tracker.onNodeComplete(nodeName, chunk[nodeName]);
        }
      }
    } finally {
      await tracker.cleanup();
    }
  }

  private async handleMonitor(
    experimentKey: string,
    cronExpression: string,
    channel: string,
    threadTs: string,
    say: (args: any) => Promise<any>,
    userContext?: string
  ): Promise<void> {
    const replyTo: SlackReplyTo = {
      channel: "slack",
      destination: channel,
      threadId: threadTs,
    };

    const watched: WatchedExperiment = {
      key: experimentKey,
      userContext,
      correlationId: uuidv4(),
      replyTo,
      addedAt: new Date().toISOString(),
      cronExpression,
    };

    this.scheduler.watch(watched);

    // Confirm monitoring setup
    await say({
      channel,
      thread_ts: threadTs,
      blocks: formatMonitorConfirmation(experimentKey, cronExpression),
      text: `Now monitoring ${experimentKey}`,
    });

    // Run first analysis immediately
    await this.handleAnalyze(experimentKey, channel, threadTs, say, userContext);
  }

  private async handleStop(
    experimentKey: string,
    channel: string,
    threadTs: string,
    say: (args: any) => Promise<any>
  ): Promise<void> {
    this.scheduler.unwatch(experimentKey);

    await say({
      channel,
      thread_ts: threadTs,
      blocks: formatStopConfirmation(experimentKey),
      text: `Stopped monitoring ${experimentKey}`,
    });
  }

  private async handleStatus(
    channel: string,
    threadTs: string,
    say: (args: any) => Promise<any>
  ): Promise<void> {
    const watched = this.scheduler.getWatched();
    const items = watched.map((w) => ({
      key: w.key,
      addedAt: w.addedAt,
      cronExpression: w.cronExpression,
    }));

    await say({
      channel,
      thread_ts: threadTs,
      blocks: formatStatusList(items),
      text: `${items.length} experiment(s) being monitored`,
    });
  }

  private async handleHelp(
    channel: string,
    threadTs: string,
    say: (args: any) => Promise<any>
  ): Promise<void> {
    await say({
      channel,
      thread_ts: threadTs,
      blocks: formatHelpMessage(),
      text: "XP Agent help",
    });
  }
}
