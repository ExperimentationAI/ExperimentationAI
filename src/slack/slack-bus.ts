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
   * Upload the dashboard HTML to Slack as a file in the thread.
   */
  private async uploadDashboard(
    filePath: string,
    channel: string,
    threadTs: string,
    experimentKey: string
  ): Promise<void> {
    try {
      if (!existsSync(filePath)) return;

      const content = readFileSync(filePath);
      await this.app.client.filesUploadV2({
        channel_id: channel,
        thread_ts: threadTs,
        filename: `${experimentKey}-dashboard.html`,
        file: content,
        title: `${experimentKey} — Experiment Dashboard`,
        initial_comment: ":bar_chart: Full interactive dashboard attached below.",
      });
    } catch (err) {
      console.error("Dashboard upload failed:", err);
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

    // Strip dashboardPath from the result passed to the formatter so the
    // local filesystem path never leaks into the Slack message text.
    // The file is uploaded separately as a Slack attachment.
    const localDashboardPath = result.dashboardPath;
    const blocks = formatAnalysisResult({ ...result, dashboardPath: undefined });

    await this.app.client.chat.postMessage({
      channel: replyTo.destination,
      thread_ts: replyTo.threadId,
      blocks,
      text: `Analysis complete for ${result.experimentKey}`, // fallback text
    });

    // Upload dashboard file as a Slack attachment in the thread
    if (localDashboardPath) {
      await this.uploadDashboard(
        localDashboardPath,
        replyTo.destination,
        replyTo.threadId,
        result.experimentKey
      );
    }
  }

  async close(): Promise<void> {
    await this.app.stop();
  }
}
