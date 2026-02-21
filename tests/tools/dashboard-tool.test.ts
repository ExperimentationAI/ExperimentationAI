import { describe, it, expect } from "vitest";
import {
  renderDashboardHtml,
  fmtPct,
  fmtNum,
  fmtDelta,
  fmtPValue,
  statusColor,
  type DashboardInput,
} from "../../src/tools/dashboard-tool.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function fullInput(): DashboardInput {
  return {
    experimentKey: "trial-length-v1",
    verdict: {
      decision: "ship",
      rationale: "Primary metric non-inferior, all guardrails pass.",
    },
    primaryMetrics: [
      {
        metric: "ltv_30d",
        variants: [
          { key: "control", n: 5000, mean: 42.5 },
          { key: "3-day", n: 4800, mean: 41.8 },
        ],
        comparisons: [
          {
            variantKey: "3-day",
            delta: -0.0165,
            relativeLift: -0.0165,
            ci: [-0.045, 0.012],
            pValue: 0.032,
            niStatus: "PASS",
          },
        ],
      },
    ],
    guardrails: [
      {
        metric: "retention_7d",
        variantKey: "3-day",
        status: "PASS",
        observedChange: -0.012,
        threshold: 0.05,
        thresholdType: "relative",
        power: 0.85,
      },
      {
        metric: "refund_rate",
        variantKey: "3-day",
        status: "PASS",
        observedChange: 0.002,
        threshold: 0.01,
        thresholdType: "absolute",
        power: 0.72,
      },
    ],
    funnel: {
      stages: ["visit", "signup", "trial_start", "conversion"],
      variants: [
        { key: "control", counts: [10000, 6000, 5000, 2000] },
        { key: "3-day", counts: [9800, 5900, 4800, 1950] },
      ],
      comparisons: [
        {
          stage: "trial_start",
          variantKey: "3-day",
          variantRate: 0.4898,
          controlRate: 0.5,
          pValue: 0.21,
          significant: false,
        },
        {
          stage: "conversion",
          variantKey: "3-day",
          variantRate: 0.199,
          controlRate: 0.2,
          pValue: 0.88,
          significant: false,
        },
      ],
      bottleneck: "signup",
    },
    maturity: {
      ready: true,
      fairComparisonDate: "2025-12-15",
      variants: [
        { key: "control", pctMature: 0.98, daysUntilAllMature: 2 },
        { key: "3-day", pctMature: 0.95, daysUntilAllMature: 5 },
      ],
      warnings: ["3-day variant has 5% immature users"],
    },
    power: {
      achievedPower: 0.82,
      requiredN: 5500,
      currentN: 4800,
      adequate: true,
    },
    decisionMatrix: [
      {
        dimension: "Primary (LTV 30d)",
        status: "PASS",
        detail: "Non-inferior at 10% margin",
      },
      {
        dimension: "Guardrail (retention)",
        status: "PASS",
        detail: "Within 5% relative threshold",
      },
      {
        dimension: "Power",
        status: "PASS",
        detail: "82% achieved power",
      },
    ],
    summary:
      "## Executive Summary\n\n**Recommendation: SHIP the 3-day trial variant.**\n\n" +
      "The 3-day trial demonstrates superior performance on 1-Month LTV per Registrant, " +
      "passes all guardrails, and delivers accelerated cash velocity.\n\n" +
      "---\n\n" +
      "### Key Findings\n\n" +
      "- LTV uplift of +9.9% vs control\n" +
      "- Retention within 5% relative threshold\n" +
      "- 82% achieved power at 98,685 registrants",
  };
}

function minimalInput(): DashboardInput {
  return {
    experimentKey: "simple-test",
    verdict: {
      decision: "keep_running",
      rationale: "Underpowered — need more data.",
    },
    primaryMetrics: [
      {
        metric: "conversion_rate",
        variants: [
          { key: "control", n: 500, mean: 0.12 },
          { key: "treatment", n: 480, mean: 0.135 },
        ],
        comparisons: [
          {
            variantKey: "treatment",
            delta: 0.015,
            relativeLift: 0.125,
            ci: [-0.02, 0.05],
            pValue: 0.42,
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

describe("Formatting helpers", () => {
  describe("fmtPct", () => {
    it("formats decimals as percentages", () => {
      expect(fmtPct(0.425)).toBe("42.5%");
      expect(fmtPct(0)).toBe("0.0%");
      expect(fmtPct(1)).toBe("100.0%");
      expect(fmtPct(0.0012)).toBe("0.1%");
    });
  });

  describe("fmtNum", () => {
    it("formats integers with commas", () => {
      expect(fmtNum(5000)).toBe("5,000");
      expect(fmtNum(42)).toBe("42");
    });

    it("formats small decimals with 4 places", () => {
      expect(fmtNum(0.0165)).toBe("0.0165");
    });

    it("formats medium decimals with 2 places", () => {
      expect(fmtNum(42.567)).toBe("42.57");
    });

    it("formats large decimals with 0 places", () => {
      expect(fmtNum(1234.5)).toBe("1235");
    });
  });

  describe("fmtDelta", () => {
    it("adds + sign for positive values", () => {
      expect(fmtDelta(0.05)).toBe("+5.0%");
    });

    it("keeps - sign for negative values", () => {
      expect(fmtDelta(-0.012)).toBe("-1.2%");
    });

    it("handles zero", () => {
      expect(fmtDelta(0)).toBe("+0.0%");
    });
  });

  describe("fmtPValue", () => {
    it("formats small p-values", () => {
      expect(fmtPValue(0.0001)).toBe("<0.001");
    });

    it("formats normal p-values", () => {
      expect(fmtPValue(0.032)).toBe("0.032");
    });

    it("formats large p-values", () => {
      expect(fmtPValue(0.5)).toBe("0.500");
    });
  });

  describe("statusColor", () => {
    it("returns green for PASS", () => {
      expect(statusColor("PASS")).toBe("#2e7d32");
    });

    it("returns red for FAIL", () => {
      expect(statusColor("FAIL")).toBe("#c62828");
    });

    it("returns orange for INCONCLUSIVE", () => {
      expect(statusColor("INCONCLUSIVE")).toBe("#ef6c00");
    });
  });
});

// ---------------------------------------------------------------------------
// renderDashboardHtml
// ---------------------------------------------------------------------------

describe("renderDashboardHtml", () => {
  describe("full input", () => {
    const html = renderDashboardHtml(fullInput());

    it("produces valid HTML document", () => {
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html");
      expect(html).toContain("</html>");
    });

    it("includes experiment key in title and heading", () => {
      expect(html).toContain("trial-length-v1");
      expect(html).toContain("<title>trial-length-v1");
    });

    it("includes Tufte CSS", () => {
      expect(html).toContain("ET Book");
      expect(html).toContain("#fffff8");
      expect(html).toContain("max-width: 960px");
    });

    it("renders verdict banner with correct color", () => {
      expect(html).toContain('data-verdict="ship"');
      expect(html).toContain("#2e7d32"); // green
      expect(html).toContain("Ship it");
      expect(html).toContain("Primary metric non-inferior");
    });

    it("renders primary metrics table", () => {
      expect(html).toContain("Primary metrics");
      expect(html).toContain("ltv_30d");
      expect(html).toContain("5,000");
      expect(html).toContain("4,800");
      expect(html).toContain("PASS"); // NI status
    });

    it("renders guardrails table", () => {
      expect(html).toContain("Guardrails");
      expect(html).toContain("retention_7d");
      expect(html).toContain("refund_rate");
    });

    it("renders funnel table with n alongside rates", () => {
      expect(html).toContain("Funnel");
      expect(html).toContain("(n=");
      expect(html).toContain("signup");
      expect(html).toContain("Bottleneck");
    });

    it("renders maturity section", () => {
      expect(html).toContain("Maturity");
      expect(html).toContain("Ready");
      expect(html).toContain("2025-12-15");
      expect(html).toContain("5% immature");
    });

    it("renders power section", () => {
      expect(html).toContain("Power");
      expect(html).toContain("Adequate");
      expect(html).toContain("82.0%");
    });

    it("renders decision matrix", () => {
      expect(html).toContain("Decision matrix");
      expect(html).toContain("Primary (LTV 30d)");
      expect(html).toContain("Non-inferior at 10% margin");
    });

    it("includes timestamp", () => {
      expect(html).toContain("Generated");
    });

    it("renders summary in a boxed panel", () => {
      expect(html).toContain("Analysis");
      expect(html).toContain('class="summary"');
      expect(html).toContain("<strong>Recommendation: SHIP the 3-day trial variant.</strong>");
    });

    it("converts markdown headings in summary", () => {
      expect(html).toContain("<h4>Key Findings</h4>");
    });

    it("converts markdown lists in summary", () => {
      expect(html).toContain("<li>");
      expect(html).toContain("LTV uplift");
    });
  });

  describe("minimal input (optional sections omitted)", () => {
    const html = renderDashboardHtml(minimalInput());

    it("renders verdict and primary metrics", () => {
      expect(html).toContain("Keep running");
      expect(html).toContain("conversion_rate");
      expect(html).toContain("simple-test");
    });

    it("omits guardrails section", () => {
      expect(html).not.toContain("Guardrails");
    });

    it("omits funnel section", () => {
      expect(html).not.toContain("Funnel");
    });

    it("omits maturity section", () => {
      expect(html).not.toContain("Maturity");
    });

    it("omits power section", () => {
      expect(html).not.toContain(">Power<");
    });

    it("omits summary section", () => {
      expect(html).not.toContain('class="summary"');
    });

    it("omits decision matrix section", () => {
      expect(html).not.toContain("Decision matrix");
    });
  });

  describe("verdict colors", () => {
    it("uses green for ship", () => {
      const input = minimalInput();
      input.verdict = { decision: "ship", rationale: "All good" };
      const html = renderDashboardHtml(input);
      expect(html).toContain('data-verdict="ship"');
      expect(html).toContain("Ship it");
    });

    it("uses amber for keep_running", () => {
      const input = minimalInput();
      input.verdict = { decision: "keep_running", rationale: "Need more data" };
      const html = renderDashboardHtml(input);
      expect(html).toContain('data-verdict="keep_running"');
      expect(html).toContain("Keep running");
      expect(html).toContain("#ef6c00");
    });

    it("uses red for kill", () => {
      const input = minimalInput();
      input.verdict = { decision: "kill", rationale: "Metric tanked" };
      const html = renderDashboardHtml(input);
      expect(html).toContain('data-verdict="kill"');
      expect(html).toContain("Kill it");
      expect(html).toContain("#c62828");
    });
  });

  describe("rates show n alongside", () => {
    it("funnel cells include (n=xxx) format", () => {
      const input = fullInput();
      const html = renderDashboardHtml(input);
      // Check that funnel rates include count in (n=xxx) format
      expect(html).toContain("(n=10,000)");
      expect(html).toContain("(n=6,000)");
      expect(html).toContain("(n=5,000)");
      expect(html).toContain("(n=2,000)");
    });
  });

  describe("HTML escaping", () => {
    it("escapes special characters in experiment key", () => {
      const input = minimalInput();
      input.experimentKey = 'test<script>alert("xss")</script>';
      const html = renderDashboardHtml(input);
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });
  });

  describe("CI dot plot", () => {
    const html = renderDashboardHtml(fullInput());

    it("renders an SVG within primary metrics", () => {
      expect(html).toContain("<svg");
      expect(html).toContain("</svg>");
    });

    it("contains circle elements for point estimates", () => {
      expect(html).toContain("<circle");
    });

    it("contains a dashed zero reference line", () => {
      expect(html).toContain('stroke-dasharray="4,3"');
    });
  });

  describe("Delta forest plot", () => {
    const html = renderDashboardHtml(fullInput());

    it("renders a forest plot SVG section", () => {
      expect(html).toContain("Effect sizes");
      expect(html).toContain('class="forest-plot"');
    });

    it("contains metric labels in the SVG", () => {
      expect(html).toContain("ltv_30d");
    });
  });

  describe("Funnel slope graph", () => {
    const html = renderDashboardHtml(fullInput());

    it("renders an SVG after funnel table", () => {
      // The funnel section should contain both a table and an SVG
      const funnelIdx = html.indexOf("Funnel");
      const maturityIdx = html.indexOf("Maturity");
      const funnelSection = html.slice(funnelIdx, maturityIdx);
      expect(funnelSection).toContain("<svg");
    });

    it("contains polyline elements for variant lines", () => {
      expect(html).toContain("<polyline");
    });

    it("includes variant labels in the SVG", () => {
      // The slope graph should direct-label the variants
      const funnelIdx = html.indexOf("Funnel");
      const maturityIdx = html.indexOf("Maturity");
      const funnelSection = html.slice(funnelIdx, maturityIdx);
      expect(funnelSection).toContain("control");
      expect(funnelSection).toContain("3-day");
    });
  });

  describe("Guardrail strip plot", () => {
    const html = renderDashboardHtml(fullInput());

    it("renders an SVG within guardrails section", () => {
      const guardrailIdx = html.indexOf("Guardrails");
      const funnelIdx = html.indexOf("Funnel");
      const guardrailSection = html.slice(guardrailIdx, funnelIdx);
      expect(guardrailSection).toContain("<svg");
    });

    it("contains dots with status colors", () => {
      // PASS status color
      expect(html).toContain('fill="#2e7d32"');
    });

    it("renders safe zone rectangles", () => {
      expect(html).toContain('fill="#e8f5e9"');
    });
  });

  describe("Minimal input omits optional charts", () => {
    const html = renderDashboardHtml(minimalInput());

    it("still renders CI dot plot for primary metrics", () => {
      expect(html).toContain("<svg");
      expect(html).toContain("<circle");
    });

    it("does not render funnel SVG", () => {
      expect(html).not.toContain("<polyline");
    });

    it("does not render guardrail strip SVG", () => {
      expect(html).not.toContain('fill="#e8f5e9"');
    });
  });
});
