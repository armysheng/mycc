import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHistoryLoader } from "./useHistoryLoader";

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

describe("useHistoryLoader", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("keeps failed old-conversation loads user-facing while preserving status for recovery", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const { result } = renderHook(() => useHistoryLoader());

    await act(async () => {
      await result.current.loadHistory("old-session");
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toContain("旧对话");
    expect(result.current.error).not.toMatch(
      /500|Internal Server Error|Failed to load messages/i,
    );
    expect(result.current.errorStatus).toBe(500);
  });
});
