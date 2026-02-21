import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Zod schemas for tool input
// ---------------------------------------------------------------------------

const VariantMetricSchema = z.object({
  key: z.string(),
  n: z.number(),
  mean: z.number(),
});

const ComparisonSchema = z.object({
  variantKey: z.string(),
  delta: z.number(),
  relativeLift: z.number(),
  ci: z.tuple([z.number(), z.number()]),
  pValue: z.number(),
  niStatus: z
    .enum(["PASS", "FAIL", "INCONCLUSIVE"])
    .optional()
    .describe("Non-inferiority status, if applicable"),
});

const PrimaryMetricSchema = z.object({
  metric: z.string(),
  variants: z.array(VariantMetricSchema),
  comparisons: z.array(ComparisonSchema),
});

const GuardrailSchema = z.object({
  metric: z.string(),
  variantKey: z.string(),
  status: z.enum(["PASS", "FAIL", "INCONCLUSIVE"]),
  observedChange: z.number(),
  threshold: z.number(),
  thresholdType: z.string(),
  power: z.number().optional(),
});

const FunnelComparisonSchema = z.object({
  stage: z.string(),
  variantKey: z.string(),
  variantRate: z.number(),
  controlRate: z.number(),
  pValue: z.number(),
  significant: z.boolean(),
});

const FunnelSchema = z.object({
  stages: z.array(z.string()),
  variants: z.array(
    z.object({
      key: z.string(),
      counts: z.array(z.number()),
    })
  ),
  comparisons: z.array(FunnelComparisonSchema),
  bottleneck: z.string().optional(),
});

const MaturityVariantSchema = z.object({
  key: z.string(),
  pctMature: z.number(),
  daysUntilAllMature: z.number().optional(),
});

const MaturitySchema = z.object({
  ready: z.boolean(),
  fairComparisonDate: z.string().optional(),
  variants: z.array(MaturityVariantSchema),
  warnings: z.array(z.string()).optional(),
});

const PowerSchema = z.object({
  achievedPower: z.number(),
  requiredN: z.number(),
  currentN: z.number(),
  adequate: z.boolean(),
});

const DecisionDimensionSchema = z.object({
  dimension: z.string(),
  status: z.enum(["PASS", "FAIL", "INCONCLUSIVE"]),
  detail: z.string(),
});

const DashboardInputSchema = z.object({
  experimentKey: z.string().describe("Experiment identifier"),
  verdict: z.object({
    decision: z
      .enum(["ship", "keep_running", "kill"])
      .describe("Overall verdict"),
    rationale: z.string().describe("One-sentence rationale"),
  }),
  primaryMetrics: z
    .array(PrimaryMetricSchema)
    .describe("Primary metric results with variant data and comparisons"),
  guardrails: z
    .array(GuardrailSchema)
    .optional()
    .describe("Guardrail check results"),
  funnel: FunnelSchema.optional().describe("Funnel analysis results"),
  maturity: MaturitySchema.optional().describe("Maturity check results"),
  power: PowerSchema.optional().describe("Power analysis results"),
  decisionMatrix: z
    .array(DecisionDimensionSchema)
    .optional()
    .describe("Cross-metric decision reasoning"),
  summary: z
    .string()
    .optional()
    .describe(
      "Prose analysis text (markdown). Rendered in a readable panel on the dashboard. " +
      "Include executive summary, key findings, caveats, and recommendation rationale. " +
      "Do NOT duplicate data already shown in tables/charts — focus on interpretation and narrative."
    ),
});

export type DashboardInput = z.infer<typeof DashboardInputSchema>;

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function fmtPct(v: number): string {
  return (v * 100).toFixed(1) + "%";
}

export function fmtNum(v: number): string {
  if (Number.isInteger(v)) return v.toLocaleString("en-US");
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

export function fmtDelta(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return sign + fmtPct(v);
}

export function fmtPValue(p: number): string {
  if (p < 0.001) return "<0.001";
  return p.toFixed(3);
}

export function statusColor(
  status: "PASS" | "FAIL" | "INCONCLUSIVE"
): string {
  switch (status) {
    case "PASS":
      return "#2e7d32";
    case "FAIL":
      return "#c62828";
    case "INCONCLUSIVE":
      return "#ef6c00";
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderVerdict(verdict: DashboardInput["verdict"]): string {
  const colorMap = {
    ship: "#2e7d32",
    keep_running: "#ef6c00",
    kill: "#c62828",
  };
  const labelMap = {
    ship: "Ship it",
    keep_running: "Keep running",
    kill: "Kill it",
  };
  const color = colorMap[verdict.decision];
  const label = labelMap[verdict.decision];

  return `
    <div class="verdict" data-verdict="${verdict.decision}" style="border-left: 4px solid ${color}; padding: 0.75em 1em; margin: 2em 0 1.5em;">
      <span style="color: ${color}; font-weight: 600; font-size: 1.1em;">${label}</span>
      <span style="color: #555; margin-left: 1em;">${escapeHtml(verdict.rationale)}</span>
    </div>`;
}

function renderPrimaryMetrics(
  metrics: DashboardInput["primaryMetrics"]
): string {
  let html = `<h2>Primary metrics</h2>`;

  for (const m of metrics) {
    html += `<p class="metric-label">${escapeHtml(m.metric)}</p>`;
    html += `<table><thead><tr>
      <th>Variant</th><th>n</th><th>Mean</th>
      <th>Delta</th><th>Rel. lift</th><th>95% CI</th>
      <th>p-value</th><th>NI</th>
    </tr></thead><tbody>`;

    // Control row
    const ctrl = m.variants.find(
      (v) => !m.comparisons.some((c) => c.variantKey === v.key)
    );
    if (ctrl) {
      html += `<tr>
        <td>${escapeHtml(ctrl.key)}</td>
        <td>${ctrl.n.toLocaleString("en-US")}</td>
        <td>${fmtNum(ctrl.mean)}</td>
        <td colspan="5" style="color: #999;">\u2014</td>
      </tr>`;
    }

    // Treatment rows
    for (const comp of m.comparisons) {
      const variant = m.variants.find((v) => v.key === comp.variantKey);
      const ni = comp.niStatus
        ? `<span style="color: ${statusColor(comp.niStatus)}">${comp.niStatus}</span>`
        : "\u2014";
      html += `<tr>
        <td>${escapeHtml(comp.variantKey)}</td>
        <td>${variant ? variant.n.toLocaleString("en-US") : "\u2014"}</td>
        <td>${variant ? fmtNum(variant.mean) : "\u2014"}</td>
        <td>${fmtDelta(comp.delta)}</td>
        <td>${fmtDelta(comp.relativeLift)}</td>
        <td>[${fmtPct(comp.ci[0])}, ${fmtPct(comp.ci[1])}]</td>
        <td>${fmtPValue(comp.pValue)}</td>
        <td>${ni}</td>
      </tr>`;
    }

    html += `</tbody></table>`;
    html += renderCIDotPlot(m.comparisons);
  }

  return html;
}

function renderGuardrails(guardrails: DashboardInput["guardrails"]): string {
  if (!guardrails || guardrails.length === 0) return "";

  let html = `<h2>Guardrails</h2>
    <table><thead><tr>
      <th>Metric</th><th>Variant</th><th>Status</th>
      <th>Observed</th><th>Threshold</th><th>Power</th>
    </tr></thead><tbody>`;

  for (const g of guardrails) {
    html += `<tr>
      <td>${escapeHtml(g.metric)}</td>
      <td>${escapeHtml(g.variantKey)}</td>
      <td><span style="color: ${statusColor(g.status)}">${g.status}</span></td>
      <td>${fmtDelta(g.observedChange)}</td>
      <td>${fmtPct(g.threshold)} ${escapeHtml(g.thresholdType)}</td>
      <td>${g.power != null ? fmtPct(g.power) : "\u2014"}</td>
    </tr>`;
  }

  html += `</tbody></table>`;
  html += renderGuardrailStrip(guardrails);
  return html;
}

function renderFunnel(funnel: DashboardInput["funnel"]): string {
  if (!funnel) return "";

  const variantKeys = funnel.variants.map((v) => v.key);

  let html = `<h2>Funnel</h2>`;
  if (funnel.bottleneck) {
    html += `<p style="color: #555;">Bottleneck: <strong>${escapeHtml(funnel.bottleneck)}</strong></p>`;
  }

  html += `<table><thead><tr><th>Stage</th>`;
  for (const k of variantKeys) {
    html += `<th>${escapeHtml(k)}</th>`;
  }
  html += `</tr></thead><tbody>`;

  for (let i = 0; i < funnel.stages.length; i++) {
    const stage = funnel.stages[i];
    html += `<tr><td>${escapeHtml(stage)}</td>`;

    for (const v of funnel.variants) {
      const count = v.counts[i];
      const total = v.counts[0]; // first stage is denominator
      const rate = total > 0 ? count / total : 0;

      // Check if this cell has a significant comparison
      const comp = funnel.comparisons.find(
        (c) => c.stage === stage && c.variantKey === v.key
      );
      const star = comp?.significant ? "*" : "";

      html += `<td>${fmtPct(rate)}${star} <span class="n">(n=${count.toLocaleString("en-US")})</span></td>`;
    }

    html += `</tr>`;
  }

  html += `</tbody></table>`;
  if (funnel.comparisons.some((c) => c.significant)) {
    html += `<p class="footnote">* p < 0.05 vs control</p>`;
  }
  html += renderFunnelSlopeGraph(funnel);
  return html;
}

function renderMaturity(maturity: DashboardInput["maturity"]): string {
  if (!maturity) return "";

  const readyColor = maturity.ready ? "#2e7d32" : "#ef6c00";
  const readyLabel = maturity.ready ? "Ready" : "Not ready";

  let html = `<h2>Maturity</h2>
    <p>Status: <span style="color: ${readyColor}; font-weight: 600;">${readyLabel}</span>`;
  if (maturity.fairComparisonDate) {
    html += ` &mdash; fair comparison date: ${escapeHtml(maturity.fairComparisonDate)}`;
  }
  html += `</p>`;

  html += `<table><thead><tr>
    <th>Variant</th><th>% mature</th><th>Days until all mature</th>
  </tr></thead><tbody>`;

  for (const v of maturity.variants) {
    html += `<tr>
      <td>${escapeHtml(v.key)}</td>
      <td>${fmtPct(v.pctMature)}</td>
      <td>${v.daysUntilAllMature != null ? v.daysUntilAllMature : "\u2014"}</td>
    </tr>`;
  }

  html += `</tbody></table>`;

  if (maturity.warnings && maturity.warnings.length > 0) {
    html += `<ul class="warnings">`;
    for (const w of maturity.warnings) {
      html += `<li>${escapeHtml(w)}</li>`;
    }
    html += `</ul>`;
  }

  return html;
}

function renderPower(power: DashboardInput["power"]): string {
  if (!power) return "";

  const adequateColor = power.adequate ? "#2e7d32" : "#ef6c00";
  const adequateLabel = power.adequate ? "Adequate" : "Underpowered";

  return `<h2>Power</h2>
    <p>
      <span style="color: ${adequateColor}; font-weight: 600;">${adequateLabel}</span> &mdash;
      achieved power ${fmtPct(power.achievedPower)},
      ${power.currentN.toLocaleString("en-US")} of ${power.requiredN.toLocaleString("en-US")} required
    </p>`;
}

function renderDecisionMatrix(
  matrix: DashboardInput["decisionMatrix"]
): string {
  if (!matrix || matrix.length === 0) return "";

  let html = `<h2>Decision matrix</h2>
    <table><thead><tr>
      <th>Dimension</th><th>Status</th><th>Detail</th>
    </tr></thead><tbody>`;

  for (const d of matrix) {
    html += `<tr>
      <td>${escapeHtml(d.dimension)}</td>
      <td><span style="color: ${statusColor(d.status)}">${d.status}</span></td>
      <td>${escapeHtml(d.detail)}</td>
    </tr>`;
  }

  html += `</tbody></table>`;
  return html;
}

function renderSummary(summary: DashboardInput["summary"]): string {
  if (!summary) return "";

  // Lightweight markdown → HTML: headings, bold, italic, lists, paragraphs, hr
  let html = escapeHtml(summary);

  // Horizontal rules
  html = html.replace(/^---+$/gm, "<hr>");

  // Headings (### before ## before #)
  html = html.replace(/^#### (.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^## (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^# (.+)$/gm, "<h2>$1</h2>");

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Unordered list items (- item)
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.+<\/li>\n?)+)/g, "<ul>$1</ul>");

  // Paragraphs: double newlines become paragraph breaks
  html = html
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      // Don't wrap blocks that already start with block-level HTML
      if (/^<(h[2-5]|ul|li|hr|table|div|section)/.test(trimmed))
        return trimmed;
      return `<p>${trimmed}</p>`;
    })
    .join("\n");

  // Clean up stray single newlines inside paragraphs
  html = html.replace(/<p>([^]*?)<\/p>/g, (_, inner) =>
    `<p>${inner.replace(/\n/g, "<br>")}</p>`
  );

  return `<h2>Analysis</h2>\n<div class="summary">${html}</div>`;
}

// ---------------------------------------------------------------------------
// SVG visualizations
// ---------------------------------------------------------------------------

const VARIANT_COLORS = ["#555", "#2166ac", "#b2182b", "#762a83", "#1b7837"];

function svgScale(
  domain: [number, number],
  range: [number, number]
): (v: number) => number {
  const span = domain[1] - domain[0];
  if (span === 0) return () => (range[0] + range[1]) / 2;
  return (v: number) =>
    range[0] + ((v - domain[0]) / span) * (range[1] - range[0]);
}

function renderCIDotPlot(
  comparisons: DashboardInput["primaryMetrics"][number]["comparisons"],
  width = 600
): string {
  if (!comparisons || comparisons.length === 0) return "";

  const rowH = 24;
  const padTop = 8;
  const axisH = 30;
  const labelW = 80;
  const plotW = width - labelW - 20;
  const height = padTop + comparisons.length * rowH + axisH;

  // Compute x domain — always include 0
  let xMin = 0;
  let xMax = 0;
  for (const c of comparisons) {
    xMin = Math.min(xMin, c.ci[0], c.relativeLift);
    xMax = Math.max(xMax, c.ci[1], c.relativeLift);
  }
  const pad = (xMax - xMin) * 0.1 || 0.01;
  xMin -= pad;
  xMax += pad;

  const x = svgScale([xMin, xMax], [labelW, labelW + plotW]);
  const zeroX = x(0);

  let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;

  // Zero reference line
  svg += `<line x1="${zeroX}" y1="${padTop}" x2="${zeroX}" y2="${padTop + comparisons.length * rowH}" stroke="#999" stroke-dasharray="4,3" stroke-width="1"/>`;

  // Rows
  for (let i = 0; i < comparisons.length; i++) {
    const c = comparisons[i];
    const cy = padTop + i * rowH + rowH / 2;
    const x1 = x(c.ci[0]);
    const x2 = x(c.ci[1]);
    const cx = x(c.relativeLift);

    // Label
    svg += `<text x="${labelW - 8}" y="${cy + 4}" text-anchor="end" font-size="11">${escapeHtml(c.variantKey)}</text>`;

    // NI shaded band (from -margin to 0) if niStatus exists
    // We don't have the margin value directly, so we skip the band

    // CI whisker
    svg += `<line x1="${x1}" y1="${cy}" x2="${x2}" y2="${cy}" stroke="#888" stroke-width="1.5"/>`;

    // Point estimate dot
    const dotColor =
      c.niStatus ? statusColor(c.niStatus) : "#333";
    svg += `<circle cx="${cx}" cy="${cy}" r="4" fill="${dotColor}"/>`;
  }

  // X axis
  const axisY = padTop + comparisons.length * rowH + 4;
  svg += `<line x1="${labelW}" y1="${axisY}" x2="${labelW + plotW}" y2="${axisY}" stroke="#ccc" stroke-width="1"/>`;

  // Tick marks (5 ticks)
  const nTicks = 5;
  for (let t = 0; t <= nTicks; t++) {
    const val = xMin + (t / nTicks) * (xMax - xMin);
    const tx = x(val);
    svg += `<line x1="${tx}" y1="${axisY}" x2="${tx}" y2="${axisY + 5}" stroke="#ccc" stroke-width="1"/>`;
    svg += `<text x="${tx}" y="${axisY + 18}" text-anchor="middle" font-size="10">${fmtPct(val)}</text>`;
  }

  svg += `</svg>`;
  return svg;
}

function renderDeltaForestPlot(
  primaryMetrics: DashboardInput["primaryMetrics"]
): string {
  // Collect all comparisons across all metrics
  const rows: {
    metricLabel: string;
    variantKey: string;
    delta: number;
    ci: [number, number];
    niStatus?: "PASS" | "FAIL" | "INCONCLUSIVE";
    isGroupHeader: boolean;
  }[] = [];

  for (const m of primaryMetrics) {
    if (m.comparisons.length === 0) continue;
    rows.push({
      metricLabel: m.metric,
      variantKey: "",
      delta: 0,
      ci: [0, 0],
      isGroupHeader: true,
    });
    for (const c of m.comparisons) {
      rows.push({
        metricLabel: m.metric,
        variantKey: c.variantKey,
        delta: c.delta,
        ci: c.ci,
        niStatus: c.niStatus,
        isGroupHeader: false,
      });
    }
  }

  if (rows.length === 0) return "";

  const width = 600;
  const rowH = 24;
  const headerH = 20;
  const padTop = 8;
  const axisH = 30;
  const labelW = 140;
  const plotW = width - labelW - 20;

  // Compute total height
  let totalRows = 0;
  for (const r of rows) {
    totalRows += r.isGroupHeader ? headerH : rowH;
  }
  const height = padTop + totalRows + axisH;

  // X domain from all deltas/CIs, always include 0
  let xMin = 0;
  let xMax = 0;
  for (const r of rows) {
    if (r.isGroupHeader) continue;
    xMin = Math.min(xMin, r.ci[0], r.delta);
    xMax = Math.max(xMax, r.ci[1], r.delta);
  }
  const pad = (xMax - xMin) * 0.1 || 0.01;
  xMin -= pad;
  xMax += pad;

  const x = svgScale([xMin, xMax], [labelW, labelW + plotW]);
  const zeroX = x(0);

  let svg = `<svg class="forest-plot" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;

  // Zero reference line
  svg += `<line x1="${zeroX}" y1="${padTop}" x2="${zeroX}" y2="${padTop + totalRows}" stroke="#999" stroke-dasharray="4,3" stroke-width="1"/>`;

  let curY = padTop;
  for (const r of rows) {
    if (r.isGroupHeader) {
      curY += headerH;
      svg += `<text x="4" y="${curY - 4}" font-size="11" font-weight="600" fill="#333">${escapeHtml(r.metricLabel)}</text>`;
      continue;
    }

    const cy = curY + rowH / 2;

    // Label
    svg += `<text x="${labelW - 8}" y="${cy + 4}" text-anchor="end" font-size="11">${escapeHtml(r.variantKey)}</text>`;

    // CI whisker
    svg += `<line x1="${x(r.ci[0])}" y1="${cy}" x2="${x(r.ci[1])}" y2="${cy}" stroke="#888" stroke-width="1.5"/>`;

    // Dot
    const dotColor = r.niStatus ? statusColor(r.niStatus) : "#333";
    svg += `<circle cx="${x(r.delta)}" cy="${cy}" r="4" fill="${dotColor}"/>`;

    curY += rowH;
  }

  // X axis
  const axisY = padTop + totalRows + 4;
  svg += `<line x1="${labelW}" y1="${axisY}" x2="${labelW + plotW}" y2="${axisY}" stroke="#ccc" stroke-width="1"/>`;

  const nTicks = 5;
  for (let t = 0; t <= nTicks; t++) {
    const val = xMin + (t / nTicks) * (xMax - xMin);
    const tx = x(val);
    svg += `<line x1="${tx}" y1="${axisY}" x2="${tx}" y2="${axisY + 5}" stroke="#ccc" stroke-width="1"/>`;
    svg += `<text x="${tx}" y="${axisY + 18}" text-anchor="middle" font-size="10">${fmtPct(val)}</text>`;
  }

  svg += `</svg>`;
  return svg;
}

function renderFunnelSlopeGraph(funnel: DashboardInput["funnel"]): string {
  if (!funnel || funnel.stages.length === 0 || funnel.variants.length === 0)
    return "";

  const width = 600;
  const height = 200;
  const padTop = 20;
  const padBottom = 20;
  const labelWLeft = 100;
  const labelWRight = 80;
  const plotW = width - labelWLeft - labelWRight;

  const stageCount = funnel.stages.length;
  const stageSpacing =
    stageCount > 1
      ? (height - padTop - padBottom) / (stageCount - 1)
      : 0;

  const x = svgScale([0, 1], [labelWLeft, labelWLeft + plotW]);

  let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;

  // Stage labels on left
  for (let i = 0; i < stageCount; i++) {
    const sy = padTop + i * stageSpacing;
    svg += `<text x="${labelWLeft - 8}" y="${sy + 4}" text-anchor="end" font-size="11">${escapeHtml(funnel.stages[i])}</text>`;
    // Faint horizontal guide
    svg += `<line x1="${labelWLeft}" y1="${sy}" x2="${labelWLeft + plotW}" y2="${sy}" stroke="#eee" stroke-width="1"/>`;
  }

  // One polyline per variant
  for (let vi = 0; vi < funnel.variants.length; vi++) {
    const v = funnel.variants[vi];
    const color = VARIANT_COLORS[vi % VARIANT_COLORS.length];
    const total = v.counts[0];
    if (total === 0) continue;

    const points: string[] = [];
    let lastX = 0;
    let lastY = 0;

    for (let i = 0; i < stageCount; i++) {
      const rate = v.counts[i] / total;
      const px = x(rate);
      const py = padTop + i * stageSpacing;
      points.push(`${px.toFixed(1)},${py.toFixed(1)}`);
      lastX = px;
      lastY = py;
    }

    const strokeW = vi === 0 ? 2 : 1.5;
    svg += `<polyline points="${points.join(" ")}" fill="none" stroke="${color}" stroke-width="${strokeW}"/>`;

    // Direct label at right end
    svg += `<text x="${lastX + 6}" y="${lastY + 4}" font-size="10" fill="${color}">${escapeHtml(v.key)}</text>`;
  }

  svg += `</svg>`;
  return svg;
}

function renderGuardrailStrip(
  guardrails: DashboardInput["guardrails"]
): string {
  if (!guardrails || guardrails.length === 0) return "";

  const width = 600;
  const rowH = 24;
  const padTop = 4;
  const labelW = 180;
  const plotW = width - labelW - 20;
  const height = padTop + guardrails.length * rowH + 4;

  // X domain: 0 to max threshold * 1.1
  let maxThresh = 0;
  for (const g of guardrails) {
    maxThresh = Math.max(maxThresh, g.threshold);
  }
  const xMax = maxThresh * 1.1 || 0.1;

  const x = svgScale([0, xMax], [labelW, labelW + plotW]);

  let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;

  for (let i = 0; i < guardrails.length; i++) {
    const g = guardrails[i];
    const cy = padTop + i * rowH + rowH / 2;
    const threshX = x(g.threshold);
    const dotX = x(Math.min(Math.abs(g.observedChange), xMax));

    // Label
    const label = `${g.metric} (${g.variantKey})`;
    svg += `<text x="${labelW - 8}" y="${cy + 4}" text-anchor="end" font-size="11">${escapeHtml(label)}</text>`;

    // Safe zone background
    svg += `<rect x="${labelW}" y="${cy - rowH / 2 + 2}" width="${threshX - labelW}" height="${rowH - 4}" fill="#e8f5e9" rx="2"/>`;

    // Threshold line
    svg += `<line x1="${threshX}" y1="${cy - rowH / 2 + 2}" x2="${threshX}" y2="${cy + rowH / 2 - 2}" stroke="#999" stroke-width="1"/>`;

    // Dot at |observedChange|
    const dotColor = statusColor(g.status);
    svg += `<circle cx="${dotX}" cy="${cy}" r="4" fill="${dotColor}"/>`;
  }

  svg += `</svg>`;
  return svg;
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

const TUFTE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: "ET Book", Palatino, "Palatino Linotype", "Palatino LT STD",
      "Book Antiqua", Georgia, serif;
    background: #fffff8;
    color: #111;
    max-width: 960px;
    margin: 0 auto;
    padding: 2em 1.5em;
    line-height: 1.5;
  }
  h1 { font-size: 1.6em; font-weight: 400; margin-bottom: 0.2em; }
  h2 {
    font-size: 1.1em;
    font-weight: 400;
    color: #333;
    margin: 1.8em 0 0.5em;
    border-bottom: 1px solid #ddd;
    padding-bottom: 0.2em;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9em;
    margin: 0.5em 0;
  }
  th {
    text-align: left;
    font-weight: 400;
    color: #555;
    border-bottom: 1px solid #999;
    padding: 0.3em 0.6em;
  }
  td {
    padding: 0.3em 0.6em;
    border-bottom: 1px solid #eee;
  }
  .n { color: #999; font-size: 0.85em; }
  .metric-label { font-weight: 600; margin: 1em 0 0.3em; }
  .footnote { font-size: 0.8em; color: #777; margin-top: 0.3em; }
  .warnings { font-size: 0.85em; color: #ef6c00; margin-top: 0.5em; padding-left: 1.2em; }
  .warnings li { margin-bottom: 0.2em; }
  .timestamp { font-size: 0.8em; color: #999; margin-top: 2em; }
  svg { display: block; margin: 0.8em 0; }
  svg text { font-family: inherit; font-size: 11px; fill: #555; }
  .summary {
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 1.2em 1.6em;
    margin: 0.5em 0 1.5em;
    line-height: 1.6;
    font-size: 0.92em;
  }
  .summary h2, .summary h3, .summary h4, .summary h5 {
    border-bottom: none;
    margin: 1.2em 0 0.4em;
  }
  .summary h3 { font-size: 1.05em; font-weight: 600; }
  .summary h4 { font-size: 0.95em; font-weight: 600; }
  .summary h5 { font-size: 0.9em; font-weight: 600; }
  .summary p { margin: 0.5em 0; }
  .summary ul { padding-left: 1.4em; margin: 0.4em 0; }
  .summary li { margin-bottom: 0.2em; }
  .summary hr { border: none; border-top: 1px solid #ddd; margin: 1em 0; }
  .summary strong { font-weight: 600; }
`;

export function renderDashboardHtml(input: DashboardInput): string {
  const timestamp = new Date().toISOString();

  const forestPlot = renderDeltaForestPlot(input.primaryMetrics);
  const forestSection = forestPlot
    ? `<h2>Effect sizes</h2>${forestPlot}`
    : "";

  const sections = [
    renderVerdict(input.verdict),
    renderSummary(input.summary),
    renderPrimaryMetrics(input.primaryMetrics),
    forestSection,
    renderGuardrails(input.guardrails),
    renderFunnel(input.funnel),
    renderMaturity(input.maturity),
    renderPower(input.power),
    renderDecisionMatrix(input.decisionMatrix),
  ]
    .filter(Boolean)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.experimentKey)} — Experiment Dashboard</title>
  <style>${TUFTE_CSS}</style>
</head>
<body>
  <h1>${escapeHtml(input.experimentKey)}</h1>
  ${sections}
  <p class="timestamp">Generated ${timestamp}</p>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createDashboardTools() {
  const renderDashboard = tool(
    async (input) => {
      const html = renderDashboardHtml(input as DashboardInput);

      const outputDir =
        process.env.XP_AGENT_OUTPUT_DIR ??
        join(tmpdir(), "xp-agent");

      mkdirSync(outputDir, { recursive: true });

      const filename = `${input.experimentKey}-dashboard-${Date.now()}.html`;
      const dashboardPath = join(outputDir, filename);

      writeFileSync(dashboardPath, html, "utf-8");

      return JSON.stringify({ dashboardPath, filename });
    },
    {
      name: "render_dashboard",
      description:
        "Render a self-contained Tufte-style HTML dashboard summarizing the experiment analysis. " +
        "Call this AFTER completing all statistical analyses and forming your verdict, " +
        "but BEFORE writing your final text conclusion. " +
        "Pass structured data from your prior tool results — no new computation needed.",
      schema: DashboardInputSchema,
    }
  );

  return [renderDashboard];
}
