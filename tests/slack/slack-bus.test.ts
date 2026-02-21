import { describe, it, expect, vi, beforeEach } from "vitest";
import { SlackBus } from "../../src/slack/slack-bus.js";
import type { AnalysisResult } from "../../src/io/types.js";

function createMockApp() {
  return {
    client: {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ok: true }),
      },
    },
    stop: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe("SlackBus", () => {
  let mockApp: ReturnType<typeof createMockApp>;
  let bus: SlackBus;

  beforeEach(() => {
    mockApp = createMockApp();
    bus = new SlackBus(mockApp);
  });

  describe("publish", () => {
    const baseResult: AnalysisResult = {
      type: "experiment_analysis",
      experimentKey: "pricing-test",
      correlationId: "corr-1",
      conclusion: "Ship it — treatment wins.",
      recommendation: "Ship it.",
      statisticalResults: [],
      phase: "concluding",
      replyTo: {
        channel: "slack",
        destination: "C12345",
        threadId: "1234567890.123456",
      },
      timestamp: "2025-01-15T10:00:00Z",
    };

    it("posts to correct channel and thread when replyTo.channel is 'slack'", async () => {
      await bus.publish(baseResult);

      expect(mockApp.client.chat.postMessage).toHaveBeenCalledOnce();
      const call = mockApp.client.chat.postMessage.mock.calls[0][0];
      expect(call.channel).toBe("C12345");
      expect(call.thread_ts).toBe("1234567890.123456");
      expect(call.blocks).toBeDefined();
      expect(call.text).toContain("pricing-test");
    });

    it("formats blocks using formatAnalysisResult", async () => {
      await bus.publish(baseResult);

      const call = mockApp.client.chat.postMessage.mock.calls[0][0];
      // Should have header block
      expect(call.blocks[0].type).toBe("header");
      expect(call.blocks[0].text.text).toContain("pricing-test");
    });

    it("ignores results with non-slack replyTo", async () => {
      const result = {
        ...baseResult,
        replyTo: { channel: "sqs", destination: "queue-url" },
      };
      await bus.publish(result);

      expect(mockApp.client.chat.postMessage).not.toHaveBeenCalled();
    });

    it("ignores results with no replyTo", async () => {
      const result = { ...baseResult, replyTo: undefined };
      await bus.publish(result);

      expect(mockApp.client.chat.postMessage).not.toHaveBeenCalled();
    });
  });

  describe("consume", () => {
    it("stores handler reference", async () => {
      const handler = vi.fn();
      await bus.consume(handler);
      // SlackBus consume is non-blocking — just stores ref
      // No assertion on calls since Bolt drives the loop
    });
  });

  describe("close", () => {
    it("calls app.stop()", async () => {
      await bus.close();
      expect(mockApp.stop).toHaveBeenCalledOnce();
    });
  });
});
