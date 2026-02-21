import { App } from "@slack/bolt";
import { SqliteStore } from "./memory/sqlite-store.js";
import { loadConfig } from "./config/index.js";
import { createGraph } from "./graph/agent.js";
import { GrowthbookAdapter } from "./platforms/growthbook.js";
import { AthenaAdapter } from "./data-sources/athena.js";
import { SqliteDataSource } from "./data-sources/sqlite.js";
import { SlackBus } from "./slack/slack-bus.js";
import { SlackBot } from "./slack/slack-bot.js";
import { Scheduler } from "./scheduler/scheduler.js";
import type { DataSource } from "./interfaces/data-source.js";

async function main() {
  const config = loadConfig();

  if (!config.slackBotToken || !config.slackAppToken) {
    console.error(
      "SLACK_BOT_TOKEN and SLACK_APP_TOKEN are required for Slack mode."
    );
    process.exit(1);
  }

  // Create Bolt app in socket mode
  const app = new App({
    token: config.slackBotToken,
    signingSecret: config.slackSigningSecret,
    socketMode: true,
    appToken: config.slackAppToken,
    port: config.slackPort,
  });

  // Create adapters
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

  // Slack message bus
  const bus = new SlackBus(app);

  // Persistent memory store
  const store = new SqliteStore(config.sqliteDataSourcePath);

  // Compile graph with SlackBus
  const compiledGraph = createGraph({
    platform,
    dataSource,
    bus,
    store,
    checkpointPath: config.checkpointPath,
    modelName: config.modelName,
  });

  // Create scheduler with terminal auto-stop callback
  const scheduler = new Scheduler({
    cronExpression: config.scheduleCron,
    concurrency: config.scheduleConcurrency,
    minRuntimeHours: config.scheduleMinRuntimeHours,
    platform,
    graph: compiledGraph,
    onTerminal: (key) => {
      console.log(`Experiment ${key} reached terminal state, auto-unwatched.`);
    },
  });
  scheduler.start();

  // Wire up the SlackBot orchestrator
  new SlackBot({
    app,
    graph: compiledGraph,
    scheduler,
    modelName: config.modelName,
  });

  // Start Bolt
  await app.start();
  console.log("xp-agent Slack bot is running!");

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.error("\nShutting down...");
    scheduler.stop();
    await app.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
