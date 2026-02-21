import type { AnalysisResult } from "../io/types.js";
import type { StatisticalTestResult } from "../stats/types.js";

// Slack Block Kit types (subset we use)
interface TextBlock {
  type: "section";
  text: { type: "mrkdwn"; text: string };
}

interface HeaderBlock {
  type: "header";
  text: { type: "plain_text"; text: string };
}

interface DividerBlock {
  type: "divider";
}

interface ContextBlock {
  type: "context";
  elements: { type: "mrkdwn"; text: string }[];
}

type Block = TextBlock | HeaderBlock | DividerBlock | ContextBlock;

/**
 * Extract verdict from conclusion text.
 * Returns "ship" | "kill" | "keep_running" | "unknown"
 */
export function extractVerdict(
  conclusion: string
): "ship" | "kill" | "keep_running" | "unknown" {
  const lower = conclusion.toLowerCase();

  if (
    /\bship\s+it\b/.test(lower) ||
    /\brecommend\s+(?:shipping|launching|rolling\s+out)\b/.test(lower)
  ) {
    return "ship";
  }

  if (
    /\bkill\s+it\b/.test(lower) ||
    /\brecommend\s+stopping\b/.test(lower) ||
    /\bexperiment\s+is\s+(?:stopped|archived)\b/.test(lower)
  ) {
    return "kill";
  }

  if (
    /\bkeep\s+running\b/.test(lower) ||
    /\binconclusive\b/.test(lower) ||
    /\bneed\s+more\s+data\b/.test(lower)
  ) {
    return "keep_running";
  }

  return "unknown";
}

const VERDICT_EMOJI: Record<string, string> = {
  ship: ":large_green_circle: *Ship it*",
  kill: ":red_circle: *Kill it*",
  keep_running: ":large_yellow_circle: *Keep running*",
  unknown: ":white_circle: *See analysis*",
};

/**
 * Format a full analysis result as Slack Block Kit blocks.
 */
export function formatAnalysisResult(result: AnalysisResult): Block[] {
  const verdict = extractVerdict(result.conclusion);
  const blocks: Block[] = [];

  // Header
  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: `Experiment: ${result.experimentKey}`,
    },
  });

  // Verdict badge
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `${VERDICT_EMOJI[verdict]}`,
    },
  });

  blocks.push({ type: "divider" });

  // Statistical results table
  if (result.statisticalResults.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: formatStatsTable(result.statisticalResults),
      },
    });
    blocks.push({ type: "divider" });
  }

  // Conclusion (chunked for Slack limits)
  const chunks = chunkText(result.conclusion, 2900);
  for (const chunk of chunks) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: chunk },
    });
  }

  // Dashboard link
  if (result.dashboardPath) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:bar_chart: <${result.dashboardPath}|View full dashboard>`,
      },
    });
  }

  // Timestamp footer
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Analysis run at ${result.timestamp} | Phase: ${result.phase}`,
      },
    ],
  });

  return blocks;
}

function formatStatsTable(results: StatisticalTestResult[]): string {
  const rows = results.map((r) => {
    const sig = r.significant ? ":white_check_mark:" : ":x:";
    const ci = `[${r.confidenceInterval.lower.toFixed(4)}, ${r.confidenceInterval.upper.toFixed(4)}]`;
    const effect =
      r.relativeEffectSize !== null
        ? `${(r.relativeEffectSize * 100).toFixed(1)}%`
        : r.effectSize.toFixed(4);
    return `${sig} *${r.testName}*: p=${r.pValue.toFixed(4)}, effect=${effect}, CI=${ci}`;
  });

  return rows.join("\n");
}

/**
 * Format monitor confirmation message.
 */
export function formatMonitorConfirmation(
  experimentKey: string,
  cronExpression: string
): Block[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:eyes: Now monitoring *${experimentKey}* on schedule \`${cronExpression}\`\nI'll post updates in this thread. Monitoring will auto-stop when a terminal verdict (ship/kill) is reached.`,
      },
    },
  ];
}

/**
 * Format stop confirmation message.
 */
export function formatStopConfirmation(experimentKey: string): Block[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:stop_sign: Stopped monitoring *${experimentKey}*.`,
      },
    },
  ];
}

/**
 * Format list of watched experiments.
 */
export function formatStatusList(
  experiments: { key: string; addedAt: string; cronExpression?: string }[]
): Block[] {
  if (experiments.length === 0) {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "No experiments are currently being monitored.",
        },
      },
    ];
  }

  const lines = experiments.map(
    (e) =>
      `• *${e.key}* — schedule: \`${e.cronExpression ?? "global"}\`, since ${e.addedAt}`
  );

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:clipboard: *Monitored experiments (${experiments.length}):*\n${lines.join("\n")}`,
      },
    },
  ];
}

/**
 * Format help message.
 */
export function formatHelpMessage(): Block[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          ":wave: *XP Agent — Commands*",
          "",
          "`analyze <experiment-key>` — Run a one-time analysis",
          "`monitor <experiment-key> [every <schedule>]` — Monitor with scheduled re-analysis (default: daily at 9am)",
          "`stop <experiment-key>` — Stop monitoring an experiment",
          "`status` — List all monitored experiments",
          "`help` — Show this message",
          "",
          "You can also ask in natural language, e.g. _\"how's the pricing test doing?\"_",
        ].join("\n"),
      },
    },
  ];
}

/**
 * Format error message.
 */
export function formatErrorMessage(err: unknown): Block[] {
  const message = err instanceof Error ? err.message : String(err);
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:warning: Something went wrong: ${message}`,
      },
    },
  ];
}

/**
 * Split text into chunks of at most `maxLen` characters, breaking at newlines.
 */
export function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    // Find last newline within the limit
    let breakAt = remaining.lastIndexOf("\n", maxLen);
    if (breakAt <= 0) {
      // No good break point — hard break at maxLen
      breakAt = maxLen;
    }
    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt + 1);
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}
