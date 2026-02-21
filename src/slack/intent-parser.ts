import { ChatAnthropic } from "@langchain/anthropic";
import type { SlackIntent } from "./types.js";

// Strip bot mention prefix (e.g. "<@U12345> analyze foo" → "analyze foo")
function stripMention(text: string): string {
  return text.replace(/^<@[A-Z0-9]+>\s*/i, "").trim();
}

// --- Regex fast-path patterns ---

const ANALYZE_RE =
  /^(?:analyze|analyse|check|review|evaluate)\s+(?:experiment\s+)?(.+)/i;

const MONITOR_RE =
  /^(?:monitor|watch|track)\s+(?:experiment\s+)?(\S+)(?:\s+(?:every|at)\s+(.+))?/i;

const STOP_RE =
  /^(?:stop|unwatch|unmonitor|cancel)\s+(?:monitoring\s+)?(?:experiment\s+)?(\S+)/i;

const STATUS_RE = /^(?:status|list|watched|what(?:'s| is) (?:being )?watched)/i;

const HELP_RE = /^(?:help|commands|usage|what can you do)\??$/i;

/**
 * Synchronous regex-based intent parser. Returns null if no pattern matches.
 */
export function parseIntentSync(text: string): SlackIntent | null {
  const cleaned = stripMention(text);

  if (HELP_RE.test(cleaned)) {
    return { type: "help" };
  }

  if (STATUS_RE.test(cleaned)) {
    return { type: "status" };
  }

  const stopMatch = cleaned.match(STOP_RE);
  if (stopMatch) {
    return { type: "stop", experimentKey: stopMatch[1] };
  }

  const monitorMatch = cleaned.match(MONITOR_RE);
  if (monitorMatch) {
    const cronExpression = monitorMatch[2]
      ? naturalLanguageToCron(monitorMatch[2])
      : "0 9 * * *"; // default: daily at 9am
    return {
      type: "monitor",
      experimentKey: monitorMatch[1],
      cronExpression,
    };
  }

  const analyzeMatch = cleaned.match(ANALYZE_RE);
  if (analyzeMatch) {
    return { type: "analyze", experimentKey: analyzeMatch[1].trim() };
  }

  return null;
}

/**
 * Full intent parser: tries regex first, falls back to LLM for natural language.
 */
export async function parseIntent(
  text: string,
  options?: { modelName?: string }
): Promise<SlackIntent> {
  const regexResult = parseIntentSync(text);
  if (regexResult) return regexResult;

  // LLM fallback for ambiguous natural language
  try {
    return await parseIntentWithLLM(text, options?.modelName);
  } catch (err) {
    console.error("LLM intent parsing failed:", err);
    return { type: "unknown", rawText: stripMention(text) };
  }
}

async function parseIntentWithLLM(
  text: string,
  modelName?: string
): Promise<SlackIntent> {
  const model = new ChatAnthropic({
    model: modelName ?? "claude-haiku-4-5-20251001",
    maxTokens: 200,
  });

  const response = await model.invoke([
    {
      role: "system",
      content: `You parse Slack messages into experiment analysis intents.
Respond with ONLY a JSON object (no markdown, no backticks).

Possible intents:
- {"type":"analyze","experimentKey":"<key>"}
- {"type":"monitor","experimentKey":"<key>","cronExpression":"<cron>"}
- {"type":"stop","experimentKey":"<key>"}
- {"type":"status"}
- {"type":"help"}
- {"type":"unknown","rawText":"<original text>"}

For monitor, use standard cron expressions (e.g. "0 9 * * *" for daily at 9am).
Extract the experiment key/name from the message. If unsure, use type "unknown".`,
    },
    { role: "user", content: stripMention(text) },
  ]);

  const content =
    typeof response.content === "string"
      ? response.content
      : response.content
          .filter((b): b is { type: "text"; text: string } => b.type === "text")
          .map((b) => b.text)
          .join("");

  // Strip markdown code fences if present
  const cleaned = content.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();
  return JSON.parse(cleaned) as SlackIntent;
}

/**
 * Maps natural language schedule descriptions to cron expressions.
 */
export function naturalLanguageToCron(schedule: string): string {
  const s = schedule.toLowerCase().trim();

  // "every N hours" or just "N hours"
  const hoursMatch = s.match(/(?:every\s+)?(\d+)\s*hours?/);
  if (hoursMatch) {
    return `0 */${hoursMatch[1]} * * *`;
  }

  // "hourly"
  if (/^hourly$/.test(s)) return "0 * * * *";

  // "every day at HH" or "daily at HH"
  const dailyAtMatch = s.match(
    /(?:every\s*day|daily)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i
  );
  if (dailyAtMatch) {
    let hour = parseInt(dailyAtMatch[1], 10);
    const minute = dailyAtMatch[2] ? parseInt(dailyAtMatch[2], 10) : 0;
    const ampm = dailyAtMatch[3]?.toLowerCase();
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    return `${minute} ${hour} * * *`;
  }

  // "every day" / "daily"
  if (/^(?:every\s*day|daily)$/.test(s)) return "0 9 * * *";

  // "twice a day" / "every 12 hours"
  if (/twice\s+a\s+day/.test(s)) return "0 9,21 * * *";

  // "every weekday" / "weekdays"
  if (/(?:every\s+)?weekdays?$/.test(s)) return "0 9 * * 1-5";

  // "weekly" / "every week"
  if (/^(?:every\s+)?week(?:ly)?$/.test(s)) return "0 9 * * 1";

  // Fallback: daily at 9am
  return "0 9 * * *";
}
