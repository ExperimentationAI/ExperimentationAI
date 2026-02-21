# xp-agent

LangGraph TypeScript agent that analyzes A/B experiments using statistical tests. It consumes experiment monitoring requests, runs the analysis with Claude, and publishes structured results.

## Quick start

```bash
npm install
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY
```

### Run interactively

```bash
npx tsx src/index.ts
```

Prompts for an experiment key and optional context file. Results are written as JSON to stdout; logs go to stderr.

### Run with a file

```bash
npx tsx src/index.ts --input requests.jsonl
```

### Pipe from stdin

```bash
echo '{"type":"monitor_experiment","experimentKey":"pricing-v2","correlationId":"run-001"}' \
  | npx tsx src/index.ts
```

### Build and test

```bash
npm run build    # TypeScript compilation
npm test         # 28 unit + integration tests
npm run test:watch
```

## How it works

The agent is a LangGraph state machine with this topology:

```
START → load_context → reasoning ⇄ tools → memory_writer → publish_result → END
```

1. **load_context** — Reads prior conclusions for this experiment from the in-memory store
2. **reasoning** — Claude analyzes the experiment using bound tools (loops back through `tools` as needed)
3. **tools** — Executes tool calls: fetch experiment details, query metrics, run statistical tests, search memory
4. **memory_writer** — Persists the conclusion to the store for future runs
5. **publish_result** — Writes the structured `AnalysisResult` to the output (stdout or SQS)

Each experiment gets a stable `thread_id` (`experiment-{key}`), so the checkpointer preserves conversation history across re-analyses.

## Message interface

### Input: `MonitorRequest`

```jsonc
{
  "type": "monitor_experiment",
  "experimentKey": "pricing-v2",        // Which experiment to analyze
  "correlationId": "run-001",           // Trace ID — ties this request to its output
  "userContext": "We hypothesize ...",   // Optional markdown context for the LLM
  "requestedBy": "stephen",             // Optional — who triggered this
  "replyTo": {                          // Optional — routing hint for downstream consumers
    "channel": "slack",
    "destination": "C04ABCDEF",
    "threadId": "1234567890.123456"
  }
}
```

| Field | Required | Purpose |
|-------|----------|---------|
| `type` | Yes | Always `"monitor_experiment"` |
| `experimentKey` | Yes | The experiment identifier in your platform (e.g. Growthbook key) |
| `correlationId` | Yes | An opaque string you generate. It's passed through unchanged to the output so you can match a request to its result. Use a UUID, a Slack message ts, a Linear issue ID — whatever helps you trace the flow. |
| `userContext` | No | Free-form markdown giving the LLM context: hypothesis, success criteria, things to watch for. Injected into the system prompt. |
| `requestedBy` | No | Who or what triggered the request. Informational only. |
| `replyTo` | No | Routing metadata passed through to the output unchanged. Downstream consumers (a Slack bot, email notifier, etc.) use this to know where to send the result. The agent itself doesn't act on it. |

### Output: `AnalysisResult`

```jsonc
{
  "type": "experiment_analysis",
  "experimentKey": "pricing-v2",
  "correlationId": "run-001",           // Echoed from input
  "conclusion": "Treatment shows ...",
  "recommendation": "Ship the ...",
  "statisticalResults": [               // Full test output for each metric
    {
      "testName": "Two-Proportion z-Test",
      "testStatistic": 2.63,
      "pValue": 0.0085,
      "confidenceInterval": { "lower": 0.013, "upper": 0.087, "level": 0.95 },
      "effectSize": 0.05,
      "relativeEffectSize": 0.25,
      "significant": true,
      "alpha": 0.05,
      "interpretation": "The treatment proportion ..."
    }
  ],
  "phase": "done",
  "replyTo": { "channel": "slack", "destination": "C04ABCDEF" },
  "timestamp": "2025-02-21T12:00:00.000Z"
}
```

The `correlationId` and `replyTo` are pass-through fields — they exist so that whatever consumes the output queue can route the result back to the right place without needing to look anything up.

## Message bus

Controlled by the `MESSAGE_BUS` env var:

| Mode | Input | Output | Use case |
|------|-------|--------|----------|
| `stdio` (default) | stdin JSON lines or `--input` file | stdout JSON lines | Local dev, scripts, piping |
| `sqs` | Long-polls `SQS_INPUT_QUEUE_URL` | Sends to `SQS_OUTPUT_QUEUE_URL` | Production |

## Scheduler

A cron job (default: every 6 hours) re-analyzes experiments from two sources:

1. **Auto-discovered** — queries the experiment platform for running experiments older than 24h
2. **Explicitly watched** — experiments registered via the input queue

Concurrency is capped (default: 3 parallel analyses). Configure via env vars:

```
SCHEDULE_CRON=0 */6 * * *
SCHEDULE_CONCURRENCY=3
SCHEDULE_MIN_RUNTIME_HOURS=24
```

## Statistical tests

Pure TypeScript implementations with no external dependencies:

- **Welch's two-sample t-test** — for continuous metrics (revenue, duration). Handles unequal variances and sample sizes.
- **Two-proportion z-test** — for binary metrics (conversion, click-through). Uses pooled standard error.

Both return p-values, confidence intervals, effect sizes, and a human-readable interpretation string.

## Extending

### Add a new experiment platform

Implement the `ExperimentPlatform` interface in `src/interfaces/experiment-platform.ts` and swap it in `src/index.ts`. The Growthbook adapter in `src/platforms/growthbook.ts` is a stub to show the shape.

### Add a new data source

Implement the `DataSource` interface in `src/interfaces/data-source.ts`. The Athena adapter in `src/data-sources/athena.ts` is a stub.

### Add downstream consumers

Consume from the SQS output queue. Each message is an `AnalysisResult` with the `replyTo` field preserved from the original request — use it to route to Slack, Linear, email, etc.
