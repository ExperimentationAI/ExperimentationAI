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
   * Publish an analysis result. If replyTo.channel === "slack", post
   * formatted blocks to the Slack channel/thread.
   */
  async publish(result: AnalysisResult): Promise<void> {
    const replyTo = result.replyTo;
    if (!replyTo || replyTo.channel !== "slack") {
      // Not a Slack-routed result — ignore silently
      return;
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
