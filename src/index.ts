import { InMemoryStore } from "@langchain/langgraph";
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

  // Create store and graph
  const store = new InMemoryStore();
  const compiledGraph = createGraph({
    platform,
    dataSource,
    bus,
    store,
    checkpointPath: config.checkpointPath,
    modelName: config.modelName,
  });

  // Create scheduler
  const scheduler = new Scheduler({
    cronExpression: config.scheduleCron,
    concurrency: config.scheduleConcurrency,
    minRuntimeHours: config.scheduleMinRuntimeHours,
    platform,
    graph: compiledGraph,
  });

  // Start scheduler
  scheduler.start();

  // Start consuming messages
  console.error("xp-agent started. Waiting for messages...");
  await bus.consume(async (msg) => {
    console.error(
      `Processing: ${msg.experimentKey} (${msg.correlationId})`
    );

    // Register with scheduler for future re-analysis
    scheduler.watch({
      key: msg.experimentKey,
      userContext: msg.userContext,
      correlationId: msg.correlationId,
      replyTo: msg.replyTo as Record<string, unknown> | undefined,
      addedAt: new Date().toISOString(),
    });

    // Immediately run analysis
    try {
      await compiledGraph.invoke(
        {
          experimentKey: msg.experimentKey,
          userContext: msg.userContext ?? null,
          correlationId: msg.correlationId,
          replyTo: msg.replyTo ?? null,
        },
        {
          configurable: { thread_id: `experiment-${msg.experimentKey}` },
        }
      );
    } catch (err) {
      console.error(`Analysis failed for ${msg.experimentKey}:`, err);
    }
  });

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.error("\nShutting down...");
    scheduler.stop();
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
