import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ProgressTracker,
  ConsoleProgressLogger,
} from "../../src/slack/progress-tracker.js";

function createMockApp() {
  return {
    client: {
      chat: {
        postMessage: vi
          .fn()
          .mockResolvedValue({ ok: true, ts: "msg-ts-1" }),
        update: vi.fn().mockResolvedValue({ ok: true }),
        delete: vi.fn().mockResolvedValue({ ok: true }),
      },
    },
  } as any;
}

describe("ProgressTracker", () => {
  let mockApp: ReturnType<typeof createMockApp>;
  let tracker: ProgressTracker;

  beforeEach(() => {
    mockApp = createMockApp();
    // Return incrementing timestamps
    let tsCounter = 1;
    mockApp.client.chat.postMessage.mockImplementation(async () => ({
      ok: true,
      ts: `msg-ts-${tsCounter++}`,
    }));

    tracker = new ProgressTracker({
      app: mockApp,
      channel: "C12345",
      threadTs: "thread-1",
      experimentKey: "pricing-test",
    });
  });

  it("posts progress message for load_context", async () => {
    await tracker.onNodeComplete("load_context", {});

    expect(mockApp.client.chat.postMessage).toHaveBeenCalledOnce();
    const call = mockApp.client.chat.postMessage.mock.calls[0][0];
    expect(call.channel).toBe("C12345");
    expect(call.thread_ts).toBe("thread-1");
    expect(call.text).toContain(":mag:");
    expect(call.text).toContain("Loading prior context");
  });

  it("posts progress message for memory_writer", async () => {
    await tracker.onNodeComplete("memory_writer", {});

    expect(mockApp.client.chat.postMessage).toHaveBeenCalledOnce();
    const call = mockApp.client.chat.postMessage.mock.calls[0][0];
    expect(call.text).toContain(":floppy_disk:");
    expect(call.text).toContain("Saving conclusions");
  });

  it("skips publish_result node", async () => {
    await tracker.onNodeComplete("publish_result", {});

    expect(mockApp.client.chat.postMessage).not.toHaveBeenCalled();
    expect(mockApp.client.chat.update).not.toHaveBeenCalled();
  });

  it("posts new message for first reasoning, then updates in-place for subsequent nodes in loop", async () => {
    // First reasoning — posts new message
    await tracker.onNodeComplete("reasoning", {});
    expect(mockApp.client.chat.postMessage).toHaveBeenCalledTimes(1);
    expect(mockApp.client.chat.update).not.toHaveBeenCalled();

    const firstCall = mockApp.client.chat.postMessage.mock.calls[0][0];
    expect(firstCall.text).toContain(":brain:");
    expect(firstCall.text).toContain("Reasoning about metrics");

    // Tools — updates in-place (not a new postMessage)
    await tracker.onNodeComplete("tools", {
      messages: [
        { tool_calls: [{ name: "list_metrics", args: {} }] },
      ],
    });
    expect(mockApp.client.chat.postMessage).toHaveBeenCalledTimes(1); // still 1
    expect(mockApp.client.chat.update).toHaveBeenCalledTimes(1);

    const updateCall1 = mockApp.client.chat.update.mock.calls[0][0];
    expect(updateCall1.ts).toBe("msg-ts-1");
    expect(updateCall1.text).toContain(":hammer_and_wrench:");
    expect(updateCall1.text).toContain("list_metrics");

    // Second reasoning — updates in-place
    await tracker.onNodeComplete("reasoning", {});
    expect(mockApp.client.chat.postMessage).toHaveBeenCalledTimes(1); // still 1
    expect(mockApp.client.chat.update).toHaveBeenCalledTimes(2);

    const updateCall2 = mockApp.client.chat.update.mock.calls[1][0];
    expect(updateCall2.text).toContain("tool round 2");
  });

  it("extracts and displays tool names from stateUpdate messages", async () => {
    // Start the reasoning loop
    await tracker.onNodeComplete("reasoning", {});

    // Tools node with multiple tool calls
    await tracker.onNodeComplete("tools", {
      messages: [
        {
          tool_calls: [
            { name: "run_t_test", args: {} },
            { name: "run_z_test", args: {} },
          ],
        },
      ],
    });

    const updateCall = mockApp.client.chat.update.mock.calls[0][0];
    expect(updateCall.text).toContain("run_t_test");
    expect(updateCall.text).toContain("run_z_test");
  });

  describe("cleanup", () => {
    it("deletes all tracked progress messages", async () => {
      await tracker.onNodeComplete("load_context", {});
      await tracker.onNodeComplete("reasoning", {});
      await tracker.onNodeComplete("memory_writer", {});

      // 3 messages posted (load_context=msg-ts-1, reasoning=msg-ts-2, memory_writer=msg-ts-3)
      expect(mockApp.client.chat.postMessage).toHaveBeenCalledTimes(3);

      await tracker.cleanup();

      expect(mockApp.client.chat.delete).toHaveBeenCalledTimes(3);
      const deletedTs = mockApp.client.chat.delete.mock.calls.map(
        (c: any[]) => c[0].ts
      );
      expect(deletedTs).toContain("msg-ts-1");
      expect(deletedTs).toContain("msg-ts-2");
      expect(deletedTs).toContain("msg-ts-3");
    });

    it("is best-effort — swallows individual deletion failures", async () => {
      await tracker.onNodeComplete("load_context", {});
      await tracker.onNodeComplete("reasoning", {});

      // Make first delete fail
      mockApp.client.chat.delete
        .mockRejectedValueOnce(new Error("channel_not_found"))
        .mockResolvedValueOnce({ ok: true });

      // Should not throw
      await expect(tracker.cleanup()).resolves.toBeUndefined();

      expect(mockApp.client.chat.delete).toHaveBeenCalledTimes(2);
    });

    it("clears tracked messages after cleanup", async () => {
      await tracker.onNodeComplete("load_context", {});
      await tracker.cleanup();

      // Reset mock
      mockApp.client.chat.delete.mockClear();

      // Second cleanup should not delete anything
      await tracker.cleanup();
      expect(mockApp.client.chat.delete).not.toHaveBeenCalled();
    });
  });
});

describe("ConsoleProgressLogger", () => {
  it("logs to console for each node", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new ConsoleProgressLogger("pricing-test");

    logger.onNodeComplete("load_context", {});
    logger.onNodeComplete("reasoning", {});
    logger.onNodeComplete("tools", {});
    logger.onNodeComplete("memory_writer", {});
    logger.onNodeComplete("publish_result", {});

    expect(spy).toHaveBeenCalledTimes(5);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[pricing-test]")
    );
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("node=load_context")
    );

    spy.mockRestore();
  });
});
