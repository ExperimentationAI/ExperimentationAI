import { createInterface } from "readline";
import { readFileSync } from "fs";
import type { MessageBus } from "./message-bus.js";
import type { MonitorRequest, AnalysisResult } from "./types.js";
import { MonitorRequestSchema } from "./types.js";
import { v4 as uuidv4 } from "uuid";

export class StdioBus implements MessageBus {
  private inputFile: string | null;
  private closed = false;

  constructor(options?: { inputFile?: string }) {
    this.inputFile = options?.inputFile ?? null;
  }

  async consume(handler: (msg: MonitorRequest) => Promise<void>): Promise<void> {
    if (this.inputFile) {
      await this.consumeFile(handler);
    } else if (process.stdin.isTTY) {
      await this.consumeInteractive(handler);
    } else {
      await this.consumeStdin(handler);
    }
  }

  private async consumeFile(handler: (msg: MonitorRequest) => Promise<void>): Promise<void> {
    const content = readFileSync(this.inputFile!, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    for (const line of lines) {
      if (this.closed) break;
      const parsed = MonitorRequestSchema.parse(JSON.parse(line));
      await handler(parsed);
    }
  }

  private async consumeStdin(handler: (msg: MonitorRequest) => Promise<void>): Promise<void> {
    const rl = createInterface({ input: process.stdin });

    for await (const line of rl) {
      if (this.closed) break;
      if (!line.trim()) continue;
      const parsed = MonitorRequestSchema.parse(JSON.parse(line));
      await handler(parsed);
    }
  }

  private async consumeInteractive(handler: (msg: MonitorRequest) => Promise<void>): Promise<void> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr, // prompts go to stderr so stdout stays clean for JSON
    });

    const question = (q: string): Promise<string> =>
      new Promise((resolve) => rl.question(q, resolve));

    while (!this.closed) {
      const experimentKey = await question("Experiment key (or 'quit'): ");
      if (experimentKey === "quit" || this.closed) {
        rl.close();
        break;
      }

      const contextPath = await question("Context file path (or empty): ");
      let userContext: string | undefined;
      if (contextPath.trim()) {
        userContext = readFileSync(contextPath.trim(), "utf-8");
      }

      const msg: MonitorRequest = {
        type: "monitor_experiment",
        experimentKey: experimentKey.trim(),
        userContext,
        correlationId: uuidv4(),
      };

      await handler(msg);
    }
  }

  async publish(result: AnalysisResult): Promise<void> {
    process.stdout.write(JSON.stringify(result) + "\n");
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
