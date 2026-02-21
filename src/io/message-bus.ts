import type { MonitorRequest, AnalysisResult } from "./types.js";

export interface MessageBus {
  /** Start consuming input messages. Calls handler for each. */
  consume(handler: (msg: MonitorRequest) => Promise<void>): Promise<void>;
  /** Publish an analysis result. */
  publish(result: AnalysisResult): Promise<void>;
  /** Graceful shutdown. */
  close(): Promise<void>;
}
