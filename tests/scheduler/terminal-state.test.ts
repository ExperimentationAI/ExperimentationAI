import { describe, it, expect, vi, beforeEach } from "vitest";
import { isTerminalState, Scheduler } from "../../src/scheduler/scheduler.js";

describe("isTerminalState", () => {
  describe("terminal conclusions (should return true)", () => {
    it("detects 'ship it'", () => {
      expect(isTerminalState("Based on these results, ship it.")).toBe(true);
    });

    it("detects 'Ship it' (case insensitive)", () => {
      expect(isTerminalState("Ship it — the treatment clearly wins.")).toBe(
        true
      );
    });

    it("detects 'recommend shipping'", () => {
      expect(
        isTerminalState("I recommend shipping this to all users.")
      ).toBe(true);
    });

    it("detects 'recommend launching'", () => {
      expect(
        isTerminalState("We recommend launching the new flow.")
      ).toBe(true);
    });

    it("detects 'recommend rolling out'", () => {
      expect(
        isTerminalState("I recommend rolling out the treatment to 100%.")
      ).toBe(true);
    });

    it("detects 'kill it'", () => {
      expect(isTerminalState("The treatment is harmful. Kill it.")).toBe(true);
    });

    it("detects 'recommend stopping'", () => {
      expect(
        isTerminalState("I recommend stopping this experiment immediately.")
      ).toBe(true);
    });

    it("detects 'experiment is stopped'", () => {
      expect(isTerminalState("The experiment is stopped.")).toBe(true);
    });

    it("detects 'experiment is archived'", () => {
      expect(isTerminalState("The experiment is archived.")).toBe(true);
    });
  });

  describe("non-terminal conclusions (should return false)", () => {
    it("returns false for 'keep running'", () => {
      expect(isTerminalState("Keep running for at least another week.")).toBe(
        false
      );
    });

    it("returns false for 'inconclusive'", () => {
      expect(
        isTerminalState("The results are inconclusive at this stage.")
      ).toBe(false);
    });

    it("returns false for 'need more data'", () => {
      expect(isTerminalState("We need more data before deciding.")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isTerminalState("")).toBe(false);
    });

    it("returns false for generic analysis text", () => {
      expect(
        isTerminalState(
          "The treatment shows a 2% lift in conversion but p-value is 0.12."
        )
      ).toBe(false);
    });

    it("returns false for partial matches like 'shipping delays'", () => {
      expect(
        isTerminalState("We observed shipping delays in the treatment group.")
      ).toBe(false);
    });
  });
});

/** Helper: create an async iterable from an array of stream chunks. */
function mockStream(chunks: Record<string, any>[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

describe("Scheduler terminal auto-unwatch", () => {
  let mockGraph: any;
  let mockPlatform: any;
  let onTerminal: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGraph = {
      invoke: vi.fn(),
      stream: vi.fn(),
    };
    mockPlatform = {
      listExperiments: vi.fn().mockResolvedValue([]),
    };
    onTerminal = vi.fn();
  });

  it("auto-unwatches when graph returns terminal conclusion", async () => {
    mockGraph.stream.mockResolvedValue(
      mockStream([
        { reasoning: { conclusion: "Ship it — treatment wins on all metrics." } },
        { publish_result: {} },
      ])
    );

    const scheduler = new Scheduler({
      cronExpression: "0 * * * *",
      concurrency: 1,
      minRuntimeHours: 0,
      platform: mockPlatform,
      graph: mockGraph,
      onTerminal,
    });

    scheduler.watch({
      key: "my-exp",
      addedAt: new Date().toISOString(),
    });

    await scheduler.analyzeExperiment("my-exp");

    expect(onTerminal).toHaveBeenCalledWith("my-exp");
    expect(scheduler.getWatched()).toEqual([]);
  });

  it("keeps watching when conclusion is non-terminal", async () => {
    mockGraph.stream.mockResolvedValue(
      mockStream([
        { reasoning: { conclusion: "Keep running, we need more data." } },
        { publish_result: {} },
      ])
    );

    const scheduler = new Scheduler({
      cronExpression: "0 * * * *",
      concurrency: 1,
      minRuntimeHours: 0,
      platform: mockPlatform,
      graph: mockGraph,
      onTerminal,
    });

    scheduler.watch({
      key: "my-exp",
      addedAt: new Date().toISOString(),
    });

    await scheduler.analyzeExperiment("my-exp");

    expect(onTerminal).not.toHaveBeenCalled();
    expect(scheduler.getWatched()).toHaveLength(1);
  });

  it("keeps watching when graph returns no conclusion", async () => {
    mockGraph.stream.mockResolvedValue(
      mockStream([
        { reasoning: {} },
        { publish_result: {} },
      ])
    );

    const scheduler = new Scheduler({
      cronExpression: "0 * * * *",
      concurrency: 1,
      minRuntimeHours: 0,
      platform: mockPlatform,
      graph: mockGraph,
      onTerminal,
    });

    scheduler.watch({
      key: "my-exp",
      addedAt: new Date().toISOString(),
    });

    await scheduler.analyzeExperiment("my-exp");

    expect(onTerminal).not.toHaveBeenCalled();
    expect(scheduler.getWatched()).toHaveLength(1);
  });
});

describe("Scheduler.getWatched", () => {
  it("returns all watched experiments", () => {
    const scheduler = new Scheduler({
      cronExpression: "0 * * * *",
      concurrency: 1,
      minRuntimeHours: 0,
      platform: { listExperiments: vi.fn() } as any,
      graph: { invoke: vi.fn() } as any,
    });

    scheduler.watch({ key: "exp-1", addedAt: "2025-01-01T00:00:00Z" });
    scheduler.watch({
      key: "exp-2",
      addedAt: "2025-01-02T00:00:00Z",
      cronExpression: "0 9 * * *",
    });

    const watched = scheduler.getWatched();
    expect(watched).toHaveLength(2);
    expect(watched.map((w) => w.key)).toContain("exp-1");
    expect(watched.map((w) => w.key)).toContain("exp-2");
  });

  it("returns empty array when no experiments watched", () => {
    const scheduler = new Scheduler({
      cronExpression: "0 * * * *",
      concurrency: 1,
      minRuntimeHours: 0,
      platform: { listExperiments: vi.fn() } as any,
      graph: { invoke: vi.fn() } as any,
    });

    expect(scheduler.getWatched()).toEqual([]);
  });
});
