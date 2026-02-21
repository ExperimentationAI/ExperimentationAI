import { describe, it, expect } from "vitest";
import {
  extractVerdict,
  formatAnalysisResult,
  formatMonitorConfirmation,
  formatStopConfirmation,
  formatStatusList,
  formatHelpMessage,
  formatErrorMessage,
  chunkText,
} from "../../src/slack/formatter.js";
import type { AnalysisResult } from "../../src/io/types.js";

describe("extractVerdict", () => {
  it("detects 'ship it'", () => {
    expect(extractVerdict("Based on the results, ship it.")).toBe("ship");
  });

  it("detects 'recommend shipping'", () => {
    expect(extractVerdict("I recommend shipping this experiment.")).toBe(
      "ship"
    );
  });

  it("detects 'recommend launching'", () => {
    expect(extractVerdict("I recommend launching the treatment.")).toBe("ship");
  });

  it("detects 'recommend rolling out'", () => {
    expect(extractVerdict("We recommend rolling out to 100%.")).toBe("ship");
  });

  it("detects 'kill it'", () => {
    expect(extractVerdict("Based on the results, kill it.")).toBe("kill");
  });

  it("detects 'recommend stopping'", () => {
    expect(extractVerdict("I recommend stopping this experiment.")).toBe(
      "kill"
    );
  });

  it("detects 'experiment is stopped'", () => {
    expect(extractVerdict("The experiment is stopped.")).toBe("kill");
  });

  it("detects 'experiment is archived'", () => {
    expect(extractVerdict("The experiment is archived.")).toBe("kill");
  });

  it("detects 'keep running'", () => {
    expect(extractVerdict("We should keep running this experiment.")).toBe(
      "keep_running"
    );
  });

  it("detects 'inconclusive'", () => {
    expect(extractVerdict("Results are inconclusive at this point.")).toBe(
      "keep_running"
    );
  });

  it("detects 'need more data'", () => {
    expect(extractVerdict("We need more data before deciding.")).toBe(
      "keep_running"
    );
  });

  it("returns unknown for ambiguous text", () => {
    expect(extractVerdict("Interesting results so far.")).toBe("unknown");
  });

  it("returns unknown for empty string", () => {
    expect(extractVerdict("")).toBe("unknown");
  });
});

describe("formatAnalysisResult", () => {
  const baseResult: AnalysisResult = {
    type: "experiment_analysis",
    experimentKey: "pricing-test",
    correlationId: "corr-1",
    conclusion: "The treatment shows a significant lift. Ship it.",
    recommendation: "Ship it.",
    statisticalResults: [
      {
        testName: "conversion_rate",
        testStatistic: 2.45,
        pValue: 0.014,
        confidenceInterval: { lower: 0.005, upper: 0.045, level: 0.95 },
        effectSize: 0.025,
        relativeEffectSize: 0.12,
        significant: true,
        alpha: 0.05,
        interpretation: "Significant lift in conversion rate",
      },
    ],
    phase: "concluding",
    timestamp: "2025-01-15T10:00:00Z",
  };

  it("produces blocks with header, verdict, stats, conclusion, footer", () => {
    const blocks = formatAnalysisResult(baseResult);

    // Header
    expect(blocks[0]).toEqual({
      type: "header",
      text: { type: "plain_text", text: "Experiment: pricing-test" },
    });

    // Verdict
    const verdictBlock = blocks[1] as any;
    expect(verdictBlock.text.text).toContain("Ship it");

    // Divider
    expect(blocks[2]).toEqual({ type: "divider" });

    // Stats
    const statsBlock = blocks[3] as any;
    expect(statsBlock.text.text).toContain("conversion_rate");
    expect(statsBlock.text.text).toContain("p=0.0140");

    // Conclusion
    const conclusionBlock = blocks[5] as any;
    expect(conclusionBlock.text.text).toContain("Ship it");

    // Footer
    const footer = blocks[blocks.length - 1] as any;
    expect(footer.type).toBe("context");
    expect(footer.elements[0].text).toContain("2025-01-15T10:00:00Z");
  });

  it("handles results with no statistical tests", () => {
    const result = { ...baseResult, statisticalResults: [] };
    const blocks = formatAnalysisResult(result);

    // Should not contain a stats section — no divider between verdict and conclusion
    const types = blocks.map((b) => b.type);
    // header, section (verdict), divider, section (conclusion), context
    expect(types).toEqual([
      "header",
      "section",
      "divider",
      "section",
      "context",
    ]);
  });

  it("includes dashboard link when dashboardPath is present", () => {
    const result = {
      ...baseResult,
      dashboardPath: "https://example.com/dashboards/pricing-test.html",
    };
    const blocks = formatAnalysisResult(result);

    const dashBlock = blocks.find(
      (b) =>
        b.type === "section" &&
        "text" in b &&
        b.text.text.includes("View full dashboard")
    );
    expect(dashBlock).toBeDefined();
    expect((dashBlock as any).text.text).toContain(result.dashboardPath);
  });

  it("omits dashboard link when dashboardPath is absent", () => {
    const blocks = formatAnalysisResult(baseResult);

    const dashBlock = blocks.find(
      (b) =>
        b.type === "section" &&
        "text" in b &&
        b.text.text.includes("View full dashboard")
    );
    expect(dashBlock).toBeUndefined();
  });
});

describe("formatMonitorConfirmation", () => {
  it("includes experiment key and cron", () => {
    const blocks = formatMonitorConfirmation("pricing-test", "0 9 * * *");
    const text = (blocks[0] as any).text.text;
    expect(text).toContain("pricing-test");
    expect(text).toContain("0 9 * * *");
    expect(text).toContain("auto-stop");
  });
});

describe("formatStopConfirmation", () => {
  it("includes experiment key", () => {
    const blocks = formatStopConfirmation("pricing-test");
    expect((blocks[0] as any).text.text).toContain("pricing-test");
  });
});

describe("formatStatusList", () => {
  it("shows 'no experiments' when empty", () => {
    const blocks = formatStatusList([]);
    expect((blocks[0] as any).text.text).toContain("No experiments");
  });

  it("lists experiments with keys and schedules", () => {
    const blocks = formatStatusList([
      {
        key: "pricing-test",
        addedAt: "2025-01-15T10:00:00Z",
        cronExpression: "0 9 * * *",
      },
      { key: "onboarding-v2", addedAt: "2025-01-14T08:00:00Z" },
    ]);
    const text = (blocks[0] as any).text.text;
    expect(text).toContain("pricing-test");
    expect(text).toContain("onboarding-v2");
    expect(text).toContain("0 9 * * *");
    expect(text).toContain("global");
  });
});

describe("formatHelpMessage", () => {
  it("includes all commands", () => {
    const blocks = formatHelpMessage();
    const text = (blocks[0] as any).text.text;
    expect(text).toContain("analyze");
    expect(text).toContain("monitor");
    expect(text).toContain("stop");
    expect(text).toContain("status");
    expect(text).toContain("help");
  });
});

describe("formatErrorMessage", () => {
  it("formats Error objects", () => {
    const blocks = formatErrorMessage(new Error("something broke"));
    expect((blocks[0] as any).text.text).toContain("something broke");
  });

  it("formats string errors", () => {
    const blocks = formatErrorMessage("whoops");
    expect((blocks[0] as any).text.text).toContain("whoops");
  });
});

describe("chunkText", () => {
  it("returns single chunk for short text", () => {
    expect(chunkText("hello", 100)).toEqual(["hello"]);
  });

  it("splits long text at newlines", () => {
    const text = "line 1\nline 2\nline 3\nline 4";
    const chunks = chunkText(text, 14);
    expect(chunks.length).toBeGreaterThan(1);
    // All chunks should be within limit
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(14);
    }
    // Reassembled text should match original (accounting for removed newlines at break points)
    expect(chunks.join("\n")).toBe(text);
  });

  it("hard breaks when no newline found", () => {
    const text = "a".repeat(100);
    const chunks = chunkText(text, 30);
    expect(chunks.length).toBe(4); // 30 + 30 + 30 + 10
    expect(chunks[0].length).toBe(30);
  });
});
