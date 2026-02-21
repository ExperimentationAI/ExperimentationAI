import type { App } from "@slack/bolt";

export interface ProgressTrackerOptions {
  app: App;
  channel: string;
  threadTs: string;
  experimentKey: string;
}

const NODE_MESSAGES: Record<string, { emoji: string; text: string }> = {
  load_context: { emoji: ":mag:", text: "Loading prior context..." },
  reasoning: { emoji: ":brain:", text: "Reasoning about metrics..." },
  tools: { emoji: ":hammer_and_wrench:", text: "Running tools..." },
  memory_writer: { emoji: ":floppy_disk:", text: "Saving conclusions..." },
};

/**
 * Extracts tool names from a graph stateUpdate's messages array.
 * Tool-call messages are AIMessages with a `tool_calls` array.
 */
function extractToolNames(stateUpdate: Record<string, unknown>): string[] {
  const messages = stateUpdate.messages as any[] | undefined;
  if (!Array.isArray(messages)) return [];

  const names: string[] = [];
  for (const msg of messages) {
    if (Array.isArray(msg?.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc.name) names.push(tc.name);
      }
    }
  }
  return names;
}

/**
 * Posts ephemeral Slack progress messages during graph execution,
 * then deletes them all once the final result lands.
 *
 * During the reasoning→tools loop, updates one message in-place
 * to avoid spamming the thread.
 */
export class ProgressTracker {
  private app: App;
  private channel: string;
  private threadTs: string;
  private experimentKey: string;

  private progressMessageTimestamps: string[] = [];
  private activeReasoningTs: string | null = null;
  private toolLoopCount = 0;

  constructor(options: ProgressTrackerOptions) {
    this.app = options.app;
    this.channel = options.channel;
    this.threadTs = options.threadTs;
    this.experimentKey = options.experimentKey;
  }

  async onNodeComplete(
    nodeName: string,
    stateUpdate: Record<string, unknown>
  ): Promise<void> {
    // Skip publish_result — the final Block Kit result immediately follows
    if (nodeName === "publish_result") {
      console.log(
        `[${this.experimentKey}] node=${nodeName} phase=publish (skipped progress)`
      );
      return;
    }

    const mapping = NODE_MESSAGES[nodeName];
    if (!mapping) {
      console.log(`[${this.experimentKey}] node=${nodeName} (unknown, skipped)`);
      return;
    }

    console.log(`[${this.experimentKey}] node=${nodeName} phase=progress`);

    const isReasoningLoop =
      nodeName === "reasoning" || nodeName === "tools";

    if (isReasoningLoop) {
      if (nodeName === "tools") this.toolLoopCount++;

      let text: string;
      if (nodeName === "reasoning") {
        text =
          this.toolLoopCount > 0
            ? `${mapping.emoji} ${mapping.text} (tool round ${this.toolLoopCount + 1})`
            : `${mapping.emoji} ${mapping.text}`;
      } else {
        const toolNames = extractToolNames(stateUpdate);
        text =
          toolNames.length > 0
            ? `${mapping.emoji} ${mapping.text} (${toolNames.join(", ")})`
            : `${mapping.emoji} ${mapping.text}`;
      }

      if (this.activeReasoningTs) {
        // Update existing message in-place
        try {
          await this.app.client.chat.update({
            channel: this.channel,
            ts: this.activeReasoningTs,
            text,
          });
        } catch (err) {
          console.error(
            `[${this.experimentKey}] Failed to update progress message:`,
            err
          );
        }
      } else {
        // Post new message for the reasoning/tools loop
        try {
          const result = await this.app.client.chat.postMessage({
            channel: this.channel,
            thread_ts: this.threadTs,
            text,
          });
          if (result.ts) {
            this.activeReasoningTs = result.ts;
            this.progressMessageTimestamps.push(result.ts);
          }
        } catch (err) {
          console.error(
            `[${this.experimentKey}] Failed to post progress message:`,
            err
          );
        }
      }
    } else {
      // Non-loop nodes (load_context, memory_writer): post a new message
      const text = `${mapping.emoji} ${mapping.text}`;
      try {
        const result = await this.app.client.chat.postMessage({
          channel: this.channel,
          thread_ts: this.threadTs,
          text,
        });
        if (result.ts) {
          this.progressMessageTimestamps.push(result.ts);
        }
      } catch (err) {
        console.error(
          `[${this.experimentKey}] Failed to post progress message:`,
          err
        );
      }
    }
  }

  /** Delete all tracked progress messages (best-effort, parallel). */
  async cleanup(): Promise<void> {
    console.log(
      `[${this.experimentKey}] Cleaning up ${this.progressMessageTimestamps.length} progress message(s)`
    );

    await Promise.allSettled(
      this.progressMessageTimestamps.map((ts) =>
        this.app.client.chat
          .delete({ channel: this.channel, ts })
          .catch((err) =>
            console.error(
              `[${this.experimentKey}] Failed to delete progress message ${ts}:`,
              err
            )
          )
      )
    );

    this.progressMessageTimestamps = [];
    this.activeReasoningTs = null;
  }
}

/**
 * Console-only progress logger for the scheduler (no Slack app).
 */
export class ConsoleProgressLogger {
  constructor(private experimentKey: string) {}

  onNodeComplete(
    nodeName: string,
    _stateUpdate: Record<string, unknown>
  ): void {
    const mapping = NODE_MESSAGES[nodeName];
    const phase = mapping ? mapping.text : nodeName;
    console.log(`[${this.experimentKey}] node=${nodeName} phase=${phase}`);
  }
}
