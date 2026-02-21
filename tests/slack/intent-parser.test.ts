import { describe, it, expect, vi } from "vitest";
import {
  parseIntentSync,
  parseIntent,
  naturalLanguageToCron,
} from "../../src/slack/intent-parser.js";

describe("parseIntentSync", () => {
  describe("analyze intent", () => {
    it("parses 'analyze experiment-key'", () => {
      expect(parseIntentSync("analyze my-experiment")).toEqual({
        type: "analyze",
        experimentKey: "my-experiment",
      });
    });

    it("parses 'check experiment pricing-test'", () => {
      expect(parseIntentSync("check experiment pricing-test")).toEqual({
        type: "analyze",
        experimentKey: "pricing-test",
      });
    });

    it("parses 'review foo-bar'", () => {
      expect(parseIntentSync("review foo-bar")).toEqual({
        type: "analyze",
        experimentKey: "foo-bar",
      });
    });

    it("strips bot mention prefix", () => {
      expect(parseIntentSync("<@U12345> analyze my-exp")).toEqual({
        type: "analyze",
        experimentKey: "my-exp",
      });
    });

    it("handles 'analyse' (British spelling)", () => {
      expect(parseIntentSync("analyse my-exp")).toEqual({
        type: "analyze",
        experimentKey: "my-exp",
      });
    });
  });

  describe("monitor intent", () => {
    it("parses 'monitor key every day'", () => {
      expect(parseIntentSync("monitor pricing-test every day")).toEqual({
        type: "monitor",
        experimentKey: "pricing-test",
        cronExpression: "0 9 * * *",
      });
    });

    it("parses 'watch key every 6 hours'", () => {
      expect(parseIntentSync("watch pricing-test every 6 hours")).toEqual({
        type: "monitor",
        experimentKey: "pricing-test",
        cronExpression: "0 */6 * * *",
      });
    });

    it("defaults to daily at 9am when no schedule given", () => {
      expect(parseIntentSync("monitor pricing-test")).toEqual({
        type: "monitor",
        experimentKey: "pricing-test",
        cronExpression: "0 9 * * *",
      });
    });

    it("parses 'track experiment key every weekday'", () => {
      expect(
        parseIntentSync("track experiment pricing-test every weekday")
      ).toEqual({
        type: "monitor",
        experimentKey: "pricing-test",
        cronExpression: "0 9 * * 1-5",
      });
    });
  });

  describe("stop intent", () => {
    it("parses 'stop key'", () => {
      expect(parseIntentSync("stop pricing-test")).toEqual({
        type: "stop",
        experimentKey: "pricing-test",
      });
    });

    it("parses 'unwatch key'", () => {
      expect(parseIntentSync("unwatch pricing-test")).toEqual({
        type: "stop",
        experimentKey: "pricing-test",
      });
    });

    it("parses 'stop monitoring experiment key'", () => {
      expect(parseIntentSync("stop monitoring experiment pricing-test")).toEqual(
        {
          type: "stop",
          experimentKey: "pricing-test",
        }
      );
    });
  });

  describe("status intent", () => {
    it("parses 'status'", () => {
      expect(parseIntentSync("status")).toEqual({ type: "status" });
    });

    it("parses 'what's being watched'", () => {
      expect(parseIntentSync("what's being watched")).toEqual({
        type: "status",
      });
    });

    it("parses 'list'", () => {
      expect(parseIntentSync("list")).toEqual({ type: "status" });
    });
  });

  describe("help intent", () => {
    it("parses 'help'", () => {
      expect(parseIntentSync("help")).toEqual({ type: "help" });
    });

    it("parses 'what can you do?'", () => {
      expect(parseIntentSync("what can you do?")).toEqual({ type: "help" });
    });

    it("parses 'commands'", () => {
      expect(parseIntentSync("commands")).toEqual({ type: "help" });
    });
  });

  describe("unknown / no match", () => {
    it("returns null for ambiguous text", () => {
      expect(parseIntentSync("how's the pricing test doing?")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseIntentSync("")).toBeNull();
    });
  });
});

describe("parseIntent (async with LLM fallback)", () => {
  it("uses regex result when available", async () => {
    const result = await parseIntent("analyze my-exp");
    expect(result).toEqual({
      type: "analyze",
      experimentKey: "my-exp",
    });
  });

  it("returns unknown when LLM is unavailable and regex fails", async () => {
    // LLM call will fail because no API key is set in test
    const result = await parseIntent("how's the pricing test doing?");
    expect(result).toEqual({
      type: "unknown",
      rawText: "how's the pricing test doing?",
    });
  });
});

describe("naturalLanguageToCron", () => {
  it("maps 'every day' to daily at 9am", () => {
    expect(naturalLanguageToCron("every day")).toBe("0 9 * * *");
  });

  it("maps 'daily' to daily at 9am", () => {
    expect(naturalLanguageToCron("daily")).toBe("0 9 * * *");
  });

  it("maps 'every 6 hours'", () => {
    expect(naturalLanguageToCron("every 6 hours")).toBe("0 */6 * * *");
  });

  it("maps 'every 1 hour'", () => {
    expect(naturalLanguageToCron("every 1 hour")).toBe("0 */1 * * *");
  });

  it("maps 'hourly'", () => {
    expect(naturalLanguageToCron("hourly")).toBe("0 * * * *");
  });

  it("maps 'daily at 3pm'", () => {
    expect(naturalLanguageToCron("daily at 3pm")).toBe("0 15 * * *");
  });

  it("maps 'every day at 14:30'", () => {
    expect(naturalLanguageToCron("every day at 14:30")).toBe("30 14 * * *");
  });

  it("maps 'twice a day'", () => {
    expect(naturalLanguageToCron("twice a day")).toBe("0 9,21 * * *");
  });

  it("maps 'weekdays'", () => {
    expect(naturalLanguageToCron("weekdays")).toBe("0 9 * * 1-5");
  });

  it("maps 'weekly'", () => {
    expect(naturalLanguageToCron("weekly")).toBe("0 9 * * 1");
  });

  it("defaults to daily at 9am for unrecognized schedule", () => {
    expect(naturalLanguageToCron("whenever you feel like it")).toBe(
      "0 9 * * *"
    );
  });
});
