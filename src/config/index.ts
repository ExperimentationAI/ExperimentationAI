import "dotenv/config";

export interface Config {
  anthropicApiKey: string;
  awsRegion: string;
  sqsInputQueueUrl: string;
  sqsOutputQueueUrl: string;
  messageBus: "stdio" | "sqs";
  scheduleCron: string;
  scheduleConcurrency: number;
  scheduleMinRuntimeHours: number;
  dataSource: "sqlite" | "athena";
  experimentPlatform: "growthbook";
  sqliteDataSourcePath: string;
  growthbookApiKey: string;
  growthbookApiUrl: string;
  athenaDatabase: string;
  athenaWorkgroup: string;
  athenaOutputLocation: string;
  modelName: string;
  checkpointPath: string;
}

export function loadConfig(): Config {
  return {
    anthropicApiKey: env("ANTHROPIC_API_KEY", ""),
    awsRegion: env("AWS_REGION", "us-east-1"),
    sqsInputQueueUrl: env("SQS_INPUT_QUEUE_URL", ""),
    sqsOutputQueueUrl: env("SQS_OUTPUT_QUEUE_URL", ""),
    messageBus: env("MESSAGE_BUS", "stdio") as "stdio" | "sqs",
    scheduleCron: env("SCHEDULE_CRON", "0 */6 * * *"),
    scheduleConcurrency: parseInt(env("SCHEDULE_CONCURRENCY", "3"), 10),
    scheduleMinRuntimeHours: parseInt(
      env("SCHEDULE_MIN_RUNTIME_HOURS", "24"),
      10
    ),
    dataSource: env("DATA_SOURCE", "sqlite") as "sqlite" | "athena",
    experimentPlatform: env("EXPERIMENT_PLATFORM", "growthbook") as "growthbook",
    sqliteDataSourcePath: env("SQLITE_DATA_SOURCE_PATH", "./data/local.db"),
    growthbookApiKey: env("GROWTHBOOK_API_KEY", ""),
    growthbookApiUrl: env("GROWTHBOOK_API_URL", "https://api.growthbook.io"),
    athenaDatabase: env("ATHENA_DATABASE", ""),
    athenaWorkgroup: env("ATHENA_WORKGROUP", "primary"),
    athenaOutputLocation: env("ATHENA_OUTPUT_LOCATION", ""),
    modelName: env("MODEL_NAME", "claude-sonnet-4-5-20250929"),
    checkpointPath: env("CHECKPOINT_PATH", ":memory:"),
  };
}

function env(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}
