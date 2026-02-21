import "dotenv/config";

export type ModelProvider = "anthropic" | "gemini";

export interface Config {
  modelProvider: ModelProvider;
  anthropicApiKey: string;
  geminiApiKey: string;
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
  slackBotToken: string;
  slackSigningSecret: string;
  slackAppToken: string;
  slackPort: number;
}

export function loadConfig(): Config {
  const provider = env("MODEL_PROVIDER", "anthropic") as ModelProvider;
  const defaultModel =
    provider === "gemini" ? "gemini-2.0-flash" : "claude-sonnet-4-6";

  return {
    modelProvider: provider,
    anthropicApiKey: env("ANTHROPIC_API_KEY", ""),
    geminiApiKey: env("GEMINI_API_KEY", ""),
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
    modelName: env("MODEL_NAME", defaultModel),
    checkpointPath: env("CHECKPOINT_PATH", ":memory:"),
    slackBotToken: env("SLACK_BOT_TOKEN", ""),
    slackSigningSecret: env("SLACK_SIGNING_SECRET", ""),
    slackAppToken: env("SLACK_APP_TOKEN", ""),
    slackPort: parseInt(env("SLACK_PORT", "3000"), 10),
  };
}

function env(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}
