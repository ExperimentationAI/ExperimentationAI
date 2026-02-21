import * as readline from "node:readline";
import { Command, GraphInterrupt } from "@langchain/langgraph";
import { SqliteStore } from "./memory/sqlite-store.js";
import { loadConfig } from "./config/index.js";
import { createGraph } from "./graph/agent.js";
import { GrowthbookAdapter } from "./platforms/growthbook.js";
import { AthenaAdapter } from "./data-sources/athena.js";
import { SqliteDataSource } from "./data-sources/sqlite.js";
import { StdioBus } from "./io/stdio-bus.js";
import { SqsBus } from "./io/sqs-bus.js";
import type { MessageBus } from "./io/message-bus.js";
import type { DataSource } from "./interfaces/data-source.js";
import { Scheduler } from "./scheduler/scheduler.js";

async function promptUser(proposal: Record<string, unknown>): Promise<boolean> {
  console.error("\n=== Config change proposed ===");
  console.error(JSON.stringify(proposal, null, 2));
  console.error("==============================");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    rl.question("Approve this change? (yes/no): ", (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "yes");
    });
  });
}

async function main() {
  const config = loadConfig();

  // Create adapters (config-driven)
  const platform = new GrowthbookAdapter(
    config.growthbookApiKey,
    config.growthbookApiUrl
  );

  let dataSource: DataSource;
  if (config.dataSource === "athena") {
    dataSource = new AthenaAdapter(
      config.athenaDatabase,
      config.athenaWorkgroup,
      config.athenaOutputLocation
    );
  } else {
    dataSource = new SqliteDataSource(config.sqliteDataSourcePath);
  }

  // Create message bus based on config
  let bus: MessageBus;
  if (config.messageBus === "sqs") {
    bus = new SqsBus({
      inputQueueUrl: config.sqsInputQueueUrl,
      outputQueueUrl: config.sqsOutputQueueUrl,
      region: config.awsRegion,
    });
  } else {
    const inputFile = parseInputArg();
    bus = new StdioBus({ inputFile: inputFile ?? undefined });
  }

  // Create persistent memory store (same DB as data source for local dev)
  const store = new SqliteStore(config.sqliteDataSourcePath);
  const compiledGraph = createGraph({
    platform,
    dataSource,
    bus,
    store,
    checkpointPath: config.checkpointPath,
    modelName: config.modelName,
  });

  // In oneshot mode (piped stdin or --input file), skip the scheduler
  // and exit after processing all messages.
  const isOneshot =
    config.messageBus === "stdio" &&
    (!process.stdin.isTTY || parseInputArg() !== null);

  const autoApprove = process.env.AUTO_APPROVE_CONFIG_CHANGES === "true";

  // Create and start scheduler only for long-running modes
  let scheduler: Scheduler | null = null;
  if (!isOneshot) {
    scheduler = new Scheduler({
      cronExpression: config.scheduleCron,
      concurrency: config.scheduleConcurrency,
      minRuntimeHours: config.scheduleMinRuntimeHours,
      platform,
      graph: compiledGraph,
    });
    scheduler.start();
  }

  // Start consuming messages
  console.error(
    isOneshot
      ? "xp-agent: processing input..."
      : "xp-agent started. Waiting for messages..."
  );
  await bus.consume(async (msg) => {
    console.error(
      `Processing: ${msg.experimentKey} (${msg.correlationId})`
    );

    // Register with scheduler for future re-analysis
    scheduler?.watch({
      key: msg.experimentKey,
      userContext: msg.userContext,
      correlationId: msg.correlationId,
      replyTo: msg.replyTo as Record<string, unknown> | undefined,
      addedAt: new Date().toISOString(),
    });

    const threadId = `experiment-${msg.experimentKey}`;
    const invokeConfig = {
      recursionLimit: 100,
      configurable: { thread_id: threadId },
    };

    // Immediately run analysis
    try {
      await compiledGraph.invoke(
        {
          experimentKey: msg.experimentKey,
          userContext: msg.userContext ?? null,
          correlationId: msg.correlationId,
          replyTo: msg.replyTo ?? null,
        },
        invokeConfig
      );
    } catch (err) {
      if (err instanceof GraphInterrupt) {
        // Graph paused for human approval of a config change
        const state = await compiledGraph.getState(invokeConfig);
        const proposal = state.tasks?.[0]?.interrupts?.[0]?.value;

        let approved = false;
        if (isOneshot && !autoApprove) {
          // Non-interactive: auto-reject unless AUTO_APPROVE_CONFIG_CHANGES=true
          console.error(
            "Config change proposed in oneshot mode — auto-rejecting. " +
            "Set AUTO_APPROVE_CONFIG_CHANGES=true to auto-approve."
          );
          if (proposal) {
            console.error(JSON.stringify(proposal, null, 2));
          }
        } else if (autoApprove) {
          console.error("Config change auto-approved via AUTO_APPROVE_CONFIG_CHANGES=true");
          approved = true;
        } else {
          // Interactive: prompt the user
          approved = await promptUser(proposal ?? {});
        }

        // Resume the graph with the approval decision
        try {
          await compiledGraph.invoke(
            new Command({ resume: { approved } }),
            invokeConfig
          );
        } catch (resumeErr) {
          console.error(
            `Resume failed for ${msg.experimentKey}:`,
            resumeErr
          );
        }
      } else {
        console.error(`Analysis failed for ${msg.experimentKey}:`, err);
      }
    }
  });

  if (isOneshot) {
    console.error("Done.");
    await bus.close();
    process.exit(0);
  }

  // Graceful shutdown for long-running modes
  process.on("SIGINT", async () => {
    console.error("\nShutting down...");
    scheduler?.stop();
    await bus.close();
    process.exit(0);
  });
}

function parseInputArg(): string | null {
  const idx = process.argv.indexOf("--input");
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return null;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
