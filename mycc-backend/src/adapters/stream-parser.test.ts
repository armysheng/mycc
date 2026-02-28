import { describe, expect, it, vi } from "vitest";
import {
  extractModel,
  extractSessionId,
  extractUsage,
  parseStreamLine,
} from "./stream-parser.js";

describe("stream-parser", () => {
  describe("parseStreamLine", () => {
    it("parses a valid JSON line", () => {
      const event = parseStreamLine('{"type":"system","session_id":"s1"}');
      expect(event).toEqual({ type: "system", session_id: "s1" });
    });

    it("returns null for empty lines", () => {
      expect(parseStreamLine("")).toBeNull();
      expect(parseStreamLine("   ")).toBeNull();
    });

    it("returns null for invalid JSON and logs error", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(parseStreamLine("{invalid-json")).toBeNull();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("extractSessionId", () => {
    it("extracts session id from system events", () => {
      expect(extractSessionId({ type: "system", session_id: "sess-123" })).toBe(
        "sess-123",
      );
    });

    it("returns null for non-system events", () => {
      expect(extractSessionId({ type: "assistant", session_id: "sess-123" })).toBe(
        null,
      );
    });
  });

  describe("extractUsage", () => {
    it("extracts usage from usage events", () => {
      expect(
        extractUsage({
          type: "usage",
          usage: { input_tokens: 11, output_tokens: 7 },
        }),
      ).toEqual({
        inputTokens: 11,
        outputTokens: 7,
      });
    });

    it("extracts usage from result events", () => {
      expect(
        extractUsage({
          type: "result",
          usage: { input_tokens: 3, output_tokens: 5 },
        }),
      ).toEqual({
        inputTokens: 3,
        outputTokens: 5,
      });
    });

    it("defaults missing token fields to zero", () => {
      expect(extractUsage({ type: "result", usage: {} })).toEqual({
        inputTokens: 0,
        outputTokens: 0,
      });
    });

    it("returns null for unsupported event types", () => {
      expect(extractUsage({ type: "assistant" })).toBeNull();
    });
  });

  describe("extractModel", () => {
    it("extracts model from system events", () => {
      expect(extractModel({ type: "system", model: "claude-3-7-sonnet" })).toBe(
        "claude-3-7-sonnet",
      );
    });

    it("returns null for non-system events", () => {
      expect(extractModel({ type: "assistant", model: "x" })).toBeNull();
    });
  });
});
