import { readFileSync, existsSync } from "node:fs";
import type { App } from "@slack/bolt";
import type { MessageBus } from "../io/message-bus.js";
import type { MonitorRequest, AnalysisResult } from "../io/types.js";
import { formatAnalysisResult } from "./formatter.js";

export class SlackBus implements MessageBus {
  private handler: ((msg: MonitorRequest) => Promise<void>) | null = null;

  constructor(private app: App) {}

  /**
   * In Slack mode, consume() stores the handler reference.
   * Bolt's event listeners drive the event loop, not polling.
   */
  async consume(
    handler: (msg: MonitorRequest) => Promise<void>
  ): Promise<void> {
    this.handler = handler;
  }

  /**
   * Upload the dashboard HTML to Slack and return its permalink.
   */
  private async uploadDashboard(
    filePath: string,
    channel: string,
    threadTs: string,
    experimentKey: string
  ): Promise<string | undefined> {
    try {
      if (!existsSync(filePath)) return undefined;

      const content = readFileSync(filePath);
      const result = await this.app.client.filesUploadV2({
        channel_id: channel,
        thread_ts: threadTs,
        filename: `${experimentKey}-dashboard.html`,
        file: content,
        title: `${experimentKey} — Experiment Dashboard`,
      });

      // filesUploadV2 returns the file info — extract permalink
      const file = (result as any).file ?? (result as any).files?.[0];
      return file?.permalink ?? undefined;
    } catch (err) {
      console.error("Dashboard upload failed:", err);
      return undefined;
    }
  }

  /**
   * Publish an analysis result. If replyTo.channel === "slack", post
   * formatted blocks to the Slack channel/thread.
   */
  async publish(result: AnalysisResult): Promise<void> {
    const replyTo = result.replyTo;
    if (!replyTo || replyTo.channel !== "slack") {
      // Not a Slack-routed result — ignore silently
      return;
    }

    // Upload dashboard file to Slack and get a permalink
    if (result.dashboardPath) {
      const permalink = await this.uploadDashboard(
        result.dashboardPath,
        replyTo.destination,
        replyTo.threadId,
        result.experimentKey
      );
      if (permalink) {
        result = { ...result, dashboardPath: permalink };
      }
    }

    const blocks = formatAnalysisResult(result);

    await this.app.client.chat.postMessage({
      channel: replyTo.destination,
      thread_ts: replyTo.threadId,
      blocks,
      text: `Analysis complete for ${result.experimentKey}`, // fallback text
    });
  }

  async close(): Promise<void> {
    await this.app.stop();
  }
}
