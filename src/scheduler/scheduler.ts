import cron from "node-cron";
import type { ExperimentPlatform } from "../interfaces/experiment-platform.js";
import type { CompiledStateGraph } from "@langchain/langgraph";

export interface SchedulerOptions {
  cronExpression: string;
  concurrency: number;
  minRuntimeHours: number;
  platform: ExperimentPlatform;
  graph: CompiledStateGraph<any, any, any>;
  onError?: (error: Error, experimentKey: string) => void;
}

interface WatchedExperiment {
  key: string;
  userContext?: string;
  correlationId?: string;
  replyTo?: Record<string, unknown>;
  addedAt: string;
}

export class Scheduler {
  private task: cron.ScheduledTask | null = null;
  private watchedExperiments = new Map<string, WatchedExperiment>();
  private running = false;

  constructor(private options: SchedulerOptions) {}

  /** Register an experiment for scheduled re-analysis. */
  watch(experiment: WatchedExperiment): void {
    this.watchedExperiments.set(experiment.key, experiment);
  }

  /** Remove an experiment from the watch list. */
  unwatch(key: string): void {
    this.watchedExperiments.delete(key);
  }

  /** Start the cron scheduler. */
  start(): void {
    if (this.task) return;

    this.task = cron.schedule(this.options.cronExpression, () => {
      this.runAll().catch((err) =>
        console.error("Scheduler run failed:", err)
      );
    });

    console.log(
      `Scheduler started: ${this.options.cronExpression} (concurrency: ${this.options.concurrency})`
    );
  }

  /** Stop the cron scheduler. */
  stop(): void {
    this.task?.stop();
    this.task = null;
  }

  /** Manually trigger analysis for all watched + auto-discovered experiments. */
  async runAll(): Promise<void> {
    if (this.running) {
      console.log("Scheduler already running, skipping.");
      return;
    }

    this.running = true;
    try {
      // Auto-discover running experiments
      const discovered = await this.discoverExperiments();

      // Merge watched + discovered (watched takes precedence for context)
      const allKeys = new Set([
        ...this.watchedExperiments.keys(),
        ...discovered.map((e) => e.key),
      ]);

      const experimentKeys = [...allKeys];
      console.log(
        `Scheduler: analyzing ${experimentKeys.length} experiments`
      );

      // Run with concurrency limit
      const semaphore = new Semaphore(this.options.concurrency);

      await Promise.allSettled(
        experimentKeys.map(async (key) => {
          await semaphore.acquire();
          try {
            await this.analyzeExperiment(key);
          } catch (err) {
            console.error(`Analysis failed for ${key}:`, err);
            this.options.onError?.(err as Error, key);
          } finally {
            semaphore.release();
          }
        })
      );
    } finally {
      this.running = false;
    }
  }

  /** Run graph for a single experiment. */
  async analyzeExperiment(key: string): Promise<void> {
    const watched = this.watchedExperiments.get(key);

    await this.options.graph.invoke(
      {
        experimentKey: key,
        userContext: watched?.userContext ?? null,
        correlationId: watched?.correlationId ?? key,
        replyTo: watched?.replyTo ?? null,
      },
      {
        configurable: { thread_id: `experiment-${key}` },
      }
    );
  }

  private async discoverExperiments(): Promise<{ key: string }[]> {
    try {
      const experiments = await this.options.platform.listExperiments({
        status: ["running"],
      });

      const now = Date.now();
      const minMs = this.options.minRuntimeHours * 60 * 60 * 1000;

      return experiments
        .filter((exp) => {
          if (!exp.dateStarted) return false;
          const started = new Date(exp.dateStarted).getTime();
          return now - started >= minMs;
        })
        .map((exp) => ({ key: exp.key }));
    } catch (err) {
      console.error("Auto-discovery failed:", err);
      return [];
    }
  }
}

/** Simple counting semaphore for concurrency limiting. */
class Semaphore {
  private current = 0;
  private queue: (() => void)[] = [];

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) {
      this.current++;
      next();
    }
  }
}
